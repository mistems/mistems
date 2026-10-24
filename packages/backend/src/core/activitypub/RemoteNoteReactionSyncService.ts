/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { EmojisRepository, MiMeta, NoteReactionsRepository, NotesRepository, UsersRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { checkHttps } from '@/misc/check-https.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import {
	isMisskeyCompatibleSoftware,
	mapRemoteReactions,
	parseMisskeyNoteUri,
	planReactionCountUpdates,
	selectStaleReactionUserIds,
	toReactionForCreate,
} from '@/misc/remote-note-reactions.js';
import type { RemoteReactionEmoji } from '@/misc/remote-note-reactions.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { IdService } from '@/core/IdService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import type { ReactionService } from '@/core/ReactionService.js';
import type { ReactionsBufferingService } from '@/core/ReactionsBufferingService.js';
import type { RemoteUserResolveService } from '@/core/RemoteUserResolveService.js';
import { ApLoggerService } from './ApLoggerService.js';

/** 相手の API の応答の大きさの上限 */
const REMOTE_API_RESPONSE_MAX_SIZE = 1024 * 256;
const REMOTE_API_TIMEOUT = 5000;
/** notes/reactions の 1 ページの件数 (相手の API の上限) */
const REMOTE_REACTIONS_PAGE_SIZE = 100;

export type RemoteNoteReactionSyncOptions = {
	/** ホストへ 1 回リクエストする前に、そのホストを渡して呼ぶ。false を返したら (上限に当たったら) そこで止める */
	consumeBudget: (host: string) => Promise<boolean>;
};

/**
 * リモートのノートのリアクションを、相手の公開 API (Misskey 系だけ) から読んで同期する。
 * ActivityPub の Note にはリアクションの情報が無いため、`notes/show` (種類と数) と
 * `notes/reactions` (誰が付けたか) を読む。
 */
@Injectable()
export class RemoteNoteReactionSyncService implements OnModuleInit {
	private logger: Logger;
	private reactionService: ReactionService;
	private reactionsBufferingService: ReactionsBufferingService;
	private remoteUserResolveService: RemoteUserResolveService;

	constructor(
		private moduleRef: ModuleRef,

		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		private httpRequestService: HttpRequestService,
		private federatedInstanceService: FederatedInstanceService,
		private utilityService: UtilityService,
		private idService: IdService,
		private customEmojiService: CustomEmojiService,
		private apLoggerService: ApLoggerService,
	) {
		this.logger = this.apLoggerService.logger.createSubLogger('reaction-sync');
	}

	onModuleInit(): void {
		// ApNoteService → 本サービス → ReactionService / RemoteUserResolveService → ApPersonService → ApNoteService の
		// 循環を避けるため、遅延して解決する
		this.reactionService = this.moduleRef.get('ReactionService');
		this.reactionsBufferingService = this.moduleRef.get('ReactionsBufferingService');
		this.remoteUserResolveService = this.moduleRef.get('RemoteUserResolveService');
	}

	/**
	 * 相手のホストの公開 API を POST で呼ぶ。HttpRequestService を通すので、private IP などへの接続は弾かれる。
	 */
	@bindThis
	private async postRemoteApi(host: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
		const res = await this.httpRequestService.send(`https://${host}/api/${endpoint}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
			timeout: REMOTE_API_TIMEOUT,
			size: REMOTE_API_RESPONSE_MAX_SIZE,
		});
		return await res.json();
	}

	/**
	 * 同期の対象なら、相手のホストとノートの id を返す。
	 */
	@bindThis
	public async getSyncTarget(note: MiNote): Promise<{ host: string; remoteNoteId: string } | null> {
		if (note.uri == null || note.userHost == null) return null;
		const host = this.utilityService.extractDbHost(note.uri);
		if (!this.utilityService.isFederationAllowedHost(host)) return null;

		const remoteNoteId = parseMisskeyNoteUri(note.uri, host);
		if (remoteNoteId == null) return null;

		const instance = await this.federatedInstanceService.fetch(host);
		if (!isMisskeyCompatibleSoftware(instance?.softwareName)) return null;

		return { host, remoteNoteId };
	}

	/**
	 * リアクションを同期する。`note.reactions` か `note_reaction` を変えたら true を返す。
	 *
	 * 1. `notes/show` で種類と数を読み、リアクションの絵文字を登録する
	 * 2. `notes/reactions` で付けたユーザーを読み、相手で取り消された行を消し (一覧を最後まで読めたときだけ)、
	 *    `note_reaction` を作る (上限に当たったらそこで止める)
	 * 3. キーごとに max(相手の数, 行の数) にする (相手で取り消されたものは減る。行の数より下には減らさない)
	 *
	 * `notes/show` が失敗したときは例外を投げる (呼び出し元で warn に残し、再取得そのものは成功として扱う)。
	 */
	@bindThis
	public async syncReactions(note: MiNote, opts: RemoteNoteReactionSyncOptions): Promise<boolean> {
		const target = await this.getSyncTarget(note);
		if (target == null) return false;
		const { host, remoteNoteId } = target;

		if (!await opts.consumeBudget(host)) {
			this.logger.debug(`host budget exhausted for ${host}, skip reaction sync of ${note.uri}`);
			return false;
		}

		const remote = await this.postRemoteApi(host, 'notes/show', { noteId: remoteNoteId });
		if (remote == null || typeof remote !== 'object') throw new Error('invalid notes/show response');
		const { reactions: remoteReactions } = remote as { reactions?: unknown };

		const mapped = mapRemoteReactions(remoteReactions, host, this.config.host);

		// 連合が禁止されたホストの絵文字のリアクションは取り込まない
		for (const emoji of mapped.emojis) {
			if (!emoji.isRemoteLocal && !this.utilityService.isFederationAllowedHost(emoji.host)) {
				delete mapped.reactions[`:${emoji.name}@${emoji.host}:`];
			}
		}
		const emojis = mapped.emojis.filter(e => e.isRemoteLocal || this.utilityService.isFederationAllowedHost(e.host));

		await this.registerEmojis(emojis, opts).catch(err => {
			// 絵文字が取れなくても、数の同期は続ける (表示は :name@host: の文字列になる)
			this.logger.warn(`failed to register reaction emojis of ${note.uri}: ${err}`);
		});

		const usersChanged = await this.syncReactionUsers(note, host, remoteNoteId, mapped.reactions, opts).catch(err => {
			// 誰が付けたかが取れなくても、数の同期は続ける
			this.logger.warn(`failed to sync reaction users of ${note.uri}: ${err}`);
			return false;
		});

		// 相手のキーを上限で切ったときは、切ったキーを「相手に無い」と取り違えないよう、増やす方向だけにする
		const countsChanged = await this.applyReactionCounts(note.id, mapped.reactions, { allowDecrease: !mapped.truncated });
		return countsChanged || usersChanged;
	}

	/**
	 * 相手の `notes/reactions` を読み、取り消された行を消し、付けたユーザーの行を作る。行を変えたら true を返す。
	 */
	@bindThis
	private async syncReactionUsers(
		note: MiNote,
		remoteHost: string,
		remoteNoteId: string,
		remoteReactions: Record<string, number>,
		opts: RemoteNoteReactionSyncOptions,
	): Promise<boolean> {
		const list = await this.fetchReactionList(note, remoteHost, remoteNoteId, opts);

		// 一覧を最後まで読めたときだけ、取り消された行を消す。途中で止まったら消さない
		const remoteTotal = Object.values(remoteReactions).reduce((a, b) => a + b, 0);
		const removed = list.complete && !(list.entries.length === 0 && remoteTotal > 0)
			? await this.removeStaleReactions(note, remoteHost, list.entries)
			: 0;

		const imported = await this.importReactionUsers(note, remoteHost, list.entries, opts);
		return removed > 0 || imported > 0;
	}

	/**
	 * 相手の `notes/reactions` を、空になるか 1 ページの件数より少なくなるまでページングして読む。
	 * 上限に当たって途中で止めたときは `complete: false` を返す。
	 */
	@bindThis
	private async fetchReactionList(
		note: MiNote,
		remoteHost: string,
		remoteNoteId: string,
		opts: RemoteNoteReactionSyncOptions,
	): Promise<{ entries: unknown[]; complete: boolean }> {
		const entries: unknown[] = [];
		let untilId: string | undefined;
		while (true) {
			if (!await opts.consumeBudget(remoteHost)) {
				this.logger.debug(`host budget exhausted for ${remoteHost}, stop reading reaction users of ${note.uri}`);
				return { entries, complete: false };
			}

			const page = await this.postRemoteApi(remoteHost, 'notes/reactions', {
				noteId: remoteNoteId,
				limit: REMOTE_REACTIONS_PAGE_SIZE,
				...(untilId != null ? { untilId } : {}),
			});
			if (!Array.isArray(page)) throw new Error('invalid notes/reactions response');
			entries.push(...page);

			if (page.length < REMOTE_REACTIONS_PAGE_SIZE) return { entries, complete: true };
			const last = page.at(-1) as { id?: unknown } | undefined;
			if (typeof last?.id !== 'string' || last.id === untilId) return { entries, complete: false };
			untilId = last.id;
		}
	}

	/**
	 * 相手のホストのユーザーの行のうち、相手の一覧に無いもの (相手で取り消されたもの) を消す。消した数を返す。
	 * 第三のホストのユーザーの行と、自分のサーバーのユーザーの行は消さない。
	 * `ReactionService.delete` で消すので `unreacted` のストリームも流れる。付けたユーザーはリモートなので、
	 * Undo の配送も通知も起きない。数は最後に applyReactionCounts でそろえる。
	 */
	@bindThis
	private async removeStaleReactions(note: MiNote, remoteHost: string, entries: unknown[]): Promise<number> {
		const listed = new Set<string>();
		for (const entry of entries) {
			if (entry == null || typeof entry !== 'object') continue;
			const user = (entry as { user?: unknown }).user as { username?: unknown; host?: unknown } | null | undefined;
			// 相手自身のユーザー (host が null) だけを数える。他のホストを名乗るものは、取り込みでも使わない
			if (user == null || typeof user.username !== 'string' || user.host != null) continue;
			listed.add(user.username.toLowerCase());
		}

		const rows = await this.noteReactionsRepository.createQueryBuilder('reaction')
			.innerJoin('reaction.user', 'user')
			.select('reaction.userId', 'userId')
			.addSelect('user.usernameLower', 'usernameLower')
			.where('reaction.noteId = :noteId', { noteId: note.id })
			.andWhere('user.host = :host', { host: remoteHost })
			.getRawMany<{ userId: string; usernameLower: string }>();

		const stale = selectStaleReactionUserIds(rows, listed);
		let removed = 0;
		for (const userId of stale) {
			const user = await this.usersRepository.findOneBy({ id: userId });
			if (user == null || user.host !== remoteHost) continue;
			try {
				await this.reactionService.delete(user, note);
				removed++;
			} catch (err) {
				if (err instanceof IdentifiableError) continue; // 同時に消されていた
				throw err;
			}
		}
		if (removed > 0) this.logger.info(`removed ${removed} reactions undone on ${remoteHost} from ${note.uri}`);
		return removed;
	}

	/**
	 * 相手の `notes/reactions` の一覧から、付けたユーザーを解決して `note_reaction` を作る。作った行の数を返す。
	 *
	 * 取り込むのは、応答したホスト自身のユーザーのリアクションだけである (なりすましを防ぐため)。
	 * 行は Like を受け取ったときと同じ `ReactionService.create` で作るので、ブロック・公開範囲・
	 * `reactionAcceptance`・使えない絵文字などは同じように弾かれる。付けたユーザーはリモートなので配送はせず、
	 * ノートの作者もリモートなので通知も作らない。
	 * `create` は数を 1 増やすが、数は最後に相手の数に合わせるので、増やした分はここで引き戻す。
	 */
	@bindThis
	private async importReactionUsers(note: MiNote, remoteHost: string, entries: unknown[], opts: RemoteNoteReactionSyncOptions): Promise<number> {
		const localHost = this.utilityService.toPuny(this.config.host);
		const incremented: Record<string, number> = {};
		let imported = 0;

		try {
			for (const entry of entries) {
				const result = await this.importReactionUser(note, entry, remoteHost, localHost, opts);
				if (result === 'budget-exhausted') break;
				if (result != null) {
					incremented[result] = (incremented[result] ?? 0) + 1;
					imported++;
				}
			}
		} finally {
			// create で増やした数を引き戻す (数は applyReactionCounts で相手の数に合わせる)
			await this.revertIncrements(note.id, incremented);
		}

		return imported;
	}

	/**
	 * 1 件のリアクションを取り込む。作った行のリアクションを返す。取り込まなかったときは null を返す。
	 */
	@bindThis
	private async importReactionUser(
		note: MiNote,
		entry: unknown,
		remoteHost: string,
		localHost: string,
		opts: RemoteNoteReactionSyncOptions,
	): Promise<string | null | 'budget-exhausted'> {
		if (entry == null || typeof entry !== 'object') return null;
		const { user: remoteUser, type } = entry as { user?: unknown; type?: unknown };
		if (remoteUser == null || typeof remoteUser !== 'object' || typeof type !== 'string') return null;
		const { username, host: rawHost } = remoteUser as { username?: unknown; host?: unknown };
		if (typeof username !== 'string' || (rawHost != null && typeof rawHost !== 'string')) return null;

		// 行を作るのは、応答したホスト自身のユーザー (host が null) のリアクションだけにする。
		// 相手は署名なしで他のホストのユーザー (自分のサーバーのユーザーを含む) を名乗れるので、
		// 第三のホストのユーザーのリアクションは、そのユーザーの署名付きの Like で届いたものだけを信じる。
		// (数は notes/show の集計で反映済みなので、ここで行を作らなくても数はずれない)
		if (rawHost != null) {
			let claimedHost: string;
			try {
				claimedHost = this.utilityService.toPuny(rawHost);
			} catch {
				return null;
			}
			if (claimedHost !== remoteHost) return null;
		}
		const userHost = remoteHost;
		if (userHost === localHost) return null;

		const reaction = toReactionForCreate(type, remoteHost, localHost, userHost);
		if (reaction == null) return null;

		// 既に自分のサーバーにいるユーザーは DB から引くだけにする (resolveUser は古いユーザーを取り直すため)
		let user: MiUser | null = await this.usersRepository.findOneBy({ usernameLower: username.toLowerCase(), host: userHost });
		if (user == null) {
			if (!await opts.consumeBudget(userHost)) {
				this.logger.debug(`host budget exhausted for ${userHost}, stop importing reaction users of ${note.uri}`);
				return 'budget-exhausted';
			}
			user = await this.remoteUserResolveService.resolveUser(username, userHost).catch(err => {
				this.logger.warn(`failed to resolve ${username}@${userHost}: ${err}`);
				return null;
			});
			if (user == null) return null;
		}

		// WebFinger の結果が別のホスト (自分のサーバーを含む) を指していたときも取り込まない
		if (user.host !== remoteHost) return null;
		if (user.isSuspended) return null;

		// 既にリアクションがあるユーザーは何もしない (別のリアクションへの置き換えもしない)
		if (await this.noteReactionsRepository.exists({ where: { noteId: note.id, userId: user.id } })) return null;

		try {
			await this.reactionService.create(user, note, reaction);
		} catch (err) {
			// ブロック・公開範囲などで弾かれたもの。Like を受け取ったときと同じく捨てる
			if (err instanceof IdentifiableError) {
				this.logger.debug(`skip reaction of ${username}@${userHost}: ${err.id}`);
				return null;
			}
			throw err;
		}

		const created = await this.noteReactionsRepository.findOneBy({ noteId: note.id, userId: user.id });
		return created?.reaction ?? null;
	}

	/**
	 * `ReactionService.create` で増やした数を引き戻す。
	 * バッファリングが有効なときは、create はバッファに差分を積むので、DB から引いておけば後で書き込まれたときに相殺される。
	 */
	@bindThis
	private async revertIncrements(noteId: MiNote['id'], incremented: Record<string, number>): Promise<void> {
		const entries = Object.entries(incremented);
		if (entries.length === 0) return;

		let sql = '"reactions"';
		const parameters: Record<string, string | number> = {};
		entries.forEach(([reaction, count], i) => {
			sql = `jsonb_set(${sql}, ARRAY[:reaction${i}], (COALESCE("reactions"->>:reaction${i}, '0')::int - :count${i})::text::jsonb)`;
			parameters[`reaction${i}`] = reaction;
			parameters[`count${i}`] = count;
		});

		await this.notesRepository.createQueryBuilder().update()
			.set({ reactions: () => sql })
			.where('id = :id', { id: noteId })
			.setParameters(parameters)
			.execute();
	}

	/**
	 * `note.reactions` を相手の数にそろえる。変えたら true を返す。
	 *
	 * - `allowDecrease: false`: 増やす方向だけ。キーごとに `GREATEST(自分の数, 相手の数, 行の数)` にする。
	 *   読んでから書くまでの間に Like が届いても加算を失わないよう、SQL の中で max を取る
	 * - `allowDecrease: true`: 相手を正とし、下限を自分のサーバーにある行の数にする (`planReactionCountUpdates`)。
	 *   書くときに行の数を SQL の中で数え直すので、同時に届いた Like の行も下限に入る
	 */
	@bindThis
	public async applyReactionCounts(noteId: MiNote['id'], remoteReactions: Record<string, number>, opts: { allowDecrease: boolean } = { allowDecrease: false }): Promise<boolean> {
		const current = await this.notesRepository.findOneBy({ id: noteId });
		if (current == null) return false;

		const rows = await this.noteReactionsRepository.createQueryBuilder('reaction')
			.select('reaction.reaction', 'reaction')
			.addSelect('COUNT(*)', 'count')
			.where('reaction.noteId = :noteId', { noteId })
			.groupBy('reaction.reaction')
			.getRawMany<{ reaction: string; count: string }>();
		const rowCounts = Object.fromEntries(rows.map(r => [r.reaction, Number(r.count)]));

		const deltas = this.meta.enableReactionsBuffering
			? (await this.reactionsBufferingService.get(noteId)).deltas
			: {};

		const updates = planReactionCountUpdates(current.reactions, remoteReactions, rowCounts, deltas, opts);
		const entries = Object.entries(updates);
		if (entries.length === 0) return false;

		if (!opts.allowDecrease) {
			let sql = '"reactions"';
			const parameters: Record<string, string | number> = {};
			entries.forEach(([reaction, count], i) => {
				sql = `jsonb_set(${sql}, ARRAY[:reaction${i}], (GREATEST(COALESCE("reactions"->>:reaction${i}, '0')::int, :count${i}))::text::jsonb)`;
				parameters[`reaction${i}`] = reaction;
				parameters[`count${i}`] = count;
			});

			await this.notesRepository.createQueryBuilder().update()
				.set({ reactions: () => sql })
				.where('id = :id', { id: noteId })
				.setParameters(parameters)
				.execute();
			return true;
		}

		// 減らす方向も: キーごとに、max(相手の数, 今の行の数) - バッファの差分 にする。0 以下ならキーを消す
		for (const [reaction] of entries) {
			const value = 'GREATEST(CAST(:remote AS int), CAST((SELECT COUNT(*) FROM "note_reaction" WHERE "note_reaction"."noteId" = :id AND "note_reaction"."reaction" = :reaction) AS int)) - CAST(:delta AS int)';
			await this.notesRepository.createQueryBuilder().update()
				.set({ reactions: () => `CASE WHEN (${value}) > 0 THEN jsonb_set("reactions", ARRAY[:reaction]::text[], to_jsonb(${value})) ELSE "reactions" - CAST(:reaction AS text) END` })
				.where('id = :id', { id: noteId })
				.setParameters({
					reaction,
					remote: remoteReactions[reaction] ?? 0,
					delta: deltas[reaction] ?? 0,
				})
				.execute();
		}

		return true;
	}

	/**
	 * リアクションに使われたリモート絵文字のうち、自分のサーバーに無いものを登録する。
	 *
	 * 絵文字は (name, host) でサーバー全体に共有されるので、URL は必ずその絵文字のホスト自身の
	 * `emoji` API から取る。相手の `reactionEmojis` に書かれた第三のホストの URL は使わない
	 * (相手が嘘の URL を返すと、第三のホストの絵文字を差し替えられてしまうため)。
	 * 第三のホストが Misskey 系でないときは登録せず、数だけを反映する。
	 * 既にある (name, host) は上書きしない。形は ApNoteService.extractEmojis の新規登録と同じにする
	 * (uri は分からないので null。後で AP のタグが来れば埋まる)。
	 */
	@bindThis
	private async registerEmojis(
		emojis: RemoteReactionEmoji[],
		opts: RemoteNoteReactionSyncOptions,
	): Promise<void> {
		if (emojis.length === 0) return;

		const byHost = new Map<string, RemoteReactionEmoji[]>();
		for (const e of emojis) byHost.set(e.host, [...(byHost.get(e.host) ?? []), e]);

		for (const [host, list] of byHost) {
			const existing = await this.emojisRepository.findBy({ host, name: In(list.map(e => e.name)) });
			const existingNames = new Set(existing.map(e => e.name));
			const missing = list.filter(e => !existingNames.has(e.name));
			if (missing.length === 0) continue;

			// 第三のホストは、Misskey 系のときだけそのホスト自身の emoji API を読む
			if (!missing[0].isRemoteLocal) {
				const instance = await this.federatedInstanceService.fetch(host);
				if (!isMisskeyCompatibleSoftware(instance?.softwareName)) continue;
			}

			for (const emoji of missing) {
				if (!await opts.consumeBudget(host)) {
					this.logger.debug(`host budget exhausted for ${host}, skip emoji ${emoji.name}`);
					break;
				}
				const res = await this.postRemoteApi(host, 'emoji', { name: emoji.name }).catch(err => {
					this.logger.warn(`failed to fetch emoji ${emoji.name}@${host}: ${err}`);
					return null;
				}) as { name?: unknown; url?: unknown; license?: unknown } | null;
				if (res == null || res.name !== emoji.name || typeof res.url !== 'string' || !checkHttps(res.url)) continue;
				const url = res.url;
				const license = typeof res.license === 'string' ? res.license : null;

				this.logger.info(`register emoji host=${host}, name=${emoji.name} (from reactions)`);
				try {
					await this.emojisRepository.insert({
						id: this.idService.gen(),
						host,
						name: emoji.name,
						uri: null,
						originalUrl: url,
						publicUrl: url,
						updatedAt: new Date(),
						aliases: [],
						license,
					});
				} catch (err) {
					// 同時に他の処理が登録したとき (host, name の一意制約) は上書きせずに無視する
					this.logger.debug(`emoji insert skipped ${emoji.name}@${host}: ${err}`);
				}
				// 「無い」をキャッシュしているかもしれないので消す
				this.customEmojiService.invalidateRemoteEmojiCache(emoji.name, host);
			}
		}
	}
}
