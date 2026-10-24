/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { EmojisRepository, NotesRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { checkHttps } from '@/misc/check-https.js';
import {
	isMisskeyCompatibleSoftware,
	mapRemoteReactions,
	mergeRemoteReactions,
	parseMisskeyNoteUri,
} from '@/misc/remote-note-reactions.js';
import type { RemoteReactionEmoji } from '@/misc/remote-note-reactions.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { IdService } from '@/core/IdService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { ApLoggerService } from './ApLoggerService.js';

/** 相手の API の応答の大きさの上限 */
const REMOTE_API_RESPONSE_MAX_SIZE = 1024 * 256;
const REMOTE_API_TIMEOUT = 5000;

export type RemoteNoteReactionSyncOptions = {
	/** ホストへ 1 回リクエストする前に、そのホストを渡して呼ぶ。false を返したら (上限に当たったら) そこで止める */
	consumeBudget: (host: string) => Promise<boolean>;
};

/**
 * リモートのノートのリアクションを、相手の公開 API (Misskey 系だけ) から読んで同期する。
 * ActivityPub の Note にはリアクションの情報が無いため、`notes/show` を読む。
 */
@Injectable()
export class RemoteNoteReactionSyncService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

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
	 * リアクションの種類と数を同期する。`note.reactions` を更新したら true を返す。
	 * 失敗したときは例外を投げる (呼び出し元で warn に残し、再取得そのものは成功として扱う)。
	 */
	@bindThis
	public async syncReactionCounts(note: MiNote, opts: RemoteNoteReactionSyncOptions): Promise<boolean> {
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

		return await this.applyReactionCounts(note.id, mapped.reactions);
	}

	/**
	 * 自分のサーバーの数と比べて増えるキーだけを、キーごとに GREATEST で更新する。
	 * 読んでから書くまでの間に Like が届いても加算を失わないよう、SQL の中で max を取る。
	 */
	@bindThis
	public async applyReactionCounts(noteId: MiNote['id'], remoteReactions: Record<string, number>): Promise<boolean> {
		const current = await this.notesRepository.findOneBy({ id: noteId });
		if (current == null) return false;

		const { changed } = mergeRemoteReactions(current.reactions, remoteReactions);
		const entries = Object.entries(changed);
		if (entries.length === 0) return false;

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
