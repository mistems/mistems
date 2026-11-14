/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 開発用シードデータの SQL の段。
//
//   node bulk.mjs --result <dir>/seed-result.json [--base-url <インスタンスの URL>] [--seed N] > bulk.sql
//
// API の段 (seed.mjs) が書いた seed-result.json を読み、次のものを入れる SQL を標準出力に書く。
// 全体が 1 つのトランザクション (BEGIN; ... COMMIT;) なので、途中で失敗すれば何も残らない。
//   - リモートのインスタンス 2 つ、ユーザー 10 人 (user / user_profile)、リモート用の drive_file (isLink)
//   - リモートのカスタム絵文字 (各インスタンス 4 個)
//   - 過去 180 日に散らばったノート (ローカル 40 人とリモート 10 人、1 人あたり約 700 件)。
//     うち 1 割はリプライ、5% はリノート
//   - リモートが絡むフォロー関係 (seed-result.json の followEdges のうち scope が "sql" のもの)
//   - リアクション (ノートの 2 割に 1〜10 個)
//   - カウンタ (user / instance / note) とハッシュタグ (hashtag テーブル)
//
// 同じ環境に 2 回流すと、インスタンスやユーザーの重複でエラーになり、トランザクションごと取り消される。
// 1 人あたりのノート数は環境変数 SEED_LOCAL_NOTES / SEED_REMOTE_NOTES (平均。既定 700) で変えられる。
// 進み具合と件数は標準エラー出力に出す。

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { genAidx } from './lib/aidx.mjs';
import { createRandom } from './lib/random.mjs';
import { BIOS, FIELD_NAMES, FIELD_VALUES, UNICODE_REACTIONS, composeNote } from './data/texts.mjs';

const TIME2000 = 946684800000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;
const SPAN_DAYS = 180;
const ROWS_PER_INSERT = 1000;
const REPLY_RATE = 0.10;
const RENOTE_RATE = 0.05;
const REACTION_RATE = 0.2;
const ATTACH_RATE = 0.1;
// リプライ・リノートの相手は、直前のこの件数のノートから選ぶ (「少し前のノート」)
const RECENT_WINDOW = 300;
// note.reactionAndUserPairCache に入れる組の上限 (packages/backend/src/const.ts と同じ)
const PAIR_CACHE_MAX = 16;
// リモートの情報を取り直そうとすると失敗するので、取り直しが起きない遠い未来の日時にしておく
const REMOTE_LAST_FETCHED_AT = '2100-01-01T00:00:00.000Z';

const SOFTWARE_VERSIONS = { misskey: '2025.10.0', mastodon: '4.4.0' };
const REMOTE_EMOJI_BASES = ['wave', 'party', 'ok', 'blob'];
// mastodon 側のユーザーが書く英語の短文 (' を含むものはエスケープの確認も兼ねる)
const REMOTE_EN_TEXTS = [
	"It's a lovely day for a walk.",
	"Don't forget your umbrella today!",
	"Let's grab some coffee later.",
	'Just finished reading a great book.',
	"I can't believe it's already Friday.",
	'Good morning, fediverse!',
	"What's everyone having for lunch?",
	'Trying out a new recipe tonight.',
];

// ---- SQL の値 ----

// 文字列リテラルにする唯一の関数。' を '' に重ねる
export function sqlLiteral(value) {
	if (value == null) return 'NULL';
	return `'${String(value).replaceAll("'", "''")}'`;
}

const jsonb = (value) => ({ jsonb: value });

function sqlValue(v) {
	if (v == null) return 'NULL';
	if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
	if (typeof v === 'number') {
		if (!Number.isFinite(v)) throw new Error(`数値ではありません: ${v}`);
		return String(v);
	}
	if (v instanceof Date) return sqlLiteral(v.toISOString());
	if (Array.isArray(v)) return v.length === 0 ? `'{}'::varchar[]` : `ARRAY[${v.map(sqlLiteral).join(',')}]::varchar[]`;
	if (typeof v === 'object' && 'jsonb' in v) return `${sqlLiteral(JSON.stringify(v.jsonb))}::jsonb`;
	return sqlLiteral(v);
}

// 1 文あたり ROWS_PER_INSERT 行までの複数行 INSERT。列は先頭の行のキーの順
function insertSql(table, rows, suffix = '') {
	if (rows.length === 0) return [];
	const columns = Object.keys(rows[0]);
	const head = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES `;
	const out = [];
	for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
		const values = rows.slice(i, i + ROWS_PER_INSERT).map((row) => `(${columns.map((c) => sqlValue(row[c])).join(',')})`);
		out.push(`${head}${values.join(',')}${suffix};`);
	}
	return out;
}

// UPDATE ... FROM (VALUES ...) でカウンタを足す。deltas は [id, ...増分]
function incrementSql(table, columns, deltas) {
	const out = [];
	const sets = columns.map((c, i) => `"${c}" = t."${c}" + v.d${i}`).join(', ');
	const alias = ['id', ...columns.map((_, i) => `d${i}`)].join(', ');
	for (let i = 0; i < deltas.length; i += ROWS_PER_INSERT) {
		const values = deltas.slice(i, i + ROWS_PER_INSERT).map((row) => `(${row.map(sqlValue).join(',')})`);
		out.push(`UPDATE "${table}" AS t SET ${sets} FROM (VALUES ${values.join(',')}) AS v(${alias}) WHERE t.id = v.id;`);
	}
	return out;
}

// ---- 補助 ----

const aidxTime = (id) => parseInt(id.slice(0, 8), 36) + TIME2000;

function shuffle(rnd, items) {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = rnd.int(0, i);
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

const sample = (rnd, items, n) => shuffle(rnd, items).slice(0, n);

// 標準正規分布 (Box-Muller)
function gaussian(rnd) {
	return Math.sqrt(-2 * Math.log(1 - rnd.next())) * Math.cos(2 * Math.PI * rnd.next());
}

// Misskey の ReactionService.normalize と同じく、合字でない絵文字から異体字セレクタを除く
const normalizeUnicodeReaction = (r) => (r.includes('‍') ? r : r.replace(/️/g, ''));

// packages/backend/src/misc/normalize-for-search.ts と同じ
const normalizeTag = (tag) => tag.normalize('NFKC').toLowerCase();

const extractTags = (text) => [...new Set([...(text ?? '').matchAll(/(?:^|\s)#([^\s#]+)/g)].map((m) => normalizeTag(m[1])))];
const extractEmojis = (text) => [...new Set([...(text ?? '').matchAll(/:([a-z0-9_+-]+):/gi)].map((m) => m[1]))];

// ---- データの生成 ----

export function generateBulk(result, opts = {}) {
	const rnd = createRandom(Number(opts.seed ?? result.seed ?? 20261023) >>> 0);
	const now = opts.now ?? Date.now();
	const baseUrl = (opts.baseUrl ?? result.baseUrl).replace(/\/$/, '');
	const localAvg = opts.localNotesPerUser ?? 700;
	const remoteAvg = opts.remoteNotesPerUser ?? 700;

	// ノートの時刻の上限: API の段のノートより前 (やりとりのノートがタイムラインの先頭に残るように)
	const apiTimes = (result.notes ?? []).map((n) => aidxTime(n.id));
	const upper = Math.min(now, ...apiTimes) - 60 * 1000;
	// 時刻はすべて anchor (upper を含む日の JST の 0 時) からの相対で決める。
	// 乱数は実行時刻と関係のない順に使い、時刻は最後に anchor へ足すだけにするので、
	// 同じシード値と同じ seed-result なら、いつ実行しても本文や関係は同じになる (変わるのは ID と時刻だけ)
	const anchor = Math.floor((upper + JST) / DAY) * DAY - JST;
	const lower = anchor - (SPAN_DAYS - 1) * DAY;

	let counter = 0;
	const newId = (time) => genAidx(time, counter++);
	const upperDate = new Date(upper);

	const usableLocalEmojis = result.emojis.filter((e) => !e.isSensitive);
	const usableLocalEmojiNames = usableLocalEmojis.map((e) => e.name);

	// ---- インスタンスとリモートの絵文字 ----
	const instances = [];
	const remoteEmojis = [];
	const emojiNamesByHost = new Map();
	result.remoteInstances.forEach((inst, i) => {
		const firstRetrievedAt = lower - (10 + i) * DAY;
		const icon = usableLocalEmojis[(i * 11) % usableLocalEmojis.length];
		instances.push({
			id: newId(firstRetrievedAt),
			firstRetrievedAt: new Date(firstRetrievedAt),
			host: inst.host,
			usersCount: 0,
			notesCount: 0,
			followingCount: 0,
			followersCount: 0,
			softwareName: inst.softwareName,
			softwareVersion: SOFTWARE_VERSIONS[inst.softwareName] ?? null,
			openRegistrations: true,
			name: inst.name,
			description: `${inst.name} は開発用のシードデータで作った表示用のリモートサーバーです (実在しません)`,
			maintainerName: 'seed',
			iconUrl: icon.url,
			faviconUrl: icon.url,
			themeColor: inst.themeColor,
			infoUpdatedAt: upperDate,
		});
		const prefix = inst.host.split('.')[0].replace('remote-', 'r');
		const names = [];
		REMOTE_EMOJI_BASES.forEach((b, k) => {
			const name = `${prefix}_${b}`;
			const src = usableLocalEmojis[(i * 4 + k + 30) % usableLocalEmojis.length];
			names.push(name);
			remoteEmojis.push({
				id: newId(firstRetrievedAt + HOUR + k),
				updatedAt: new Date(firstRetrievedAt + HOUR + k),
				name,
				host: inst.host,
				originalUrl: src.url,
				publicUrl: src.url,
				uri: `https://${inst.host}/emojis/${name}`,
				type: 'image/png',
				aliases: [],
				category: null,
			});
		});
		emojiNamesByHost.set(inst.host, names);
	});
	const softwareOf = new Map(result.remoteInstances.map((i) => [i.host, i.softwareName]));

	// ---- リモートのユーザー ----
	const remoteUsers = [];
	const remoteProfiles = [];
	const driveFiles = [];
	const avatarUpdates = []; // [id, avatarId, avatarUrl, bannerId, bannerUrl]
	const bannerSources = result.users.filter((u) => u.bannerUrl).map((u) => u.bannerUrl);
	const linkFile = (owner, time, name, url, width, height) => {
		const f = {
			id: newId(time),
			userId: owner.id,
			userHost: owner.host,
			md5: crypto.createHash('md5').update(url).digest('hex'),
			name,
			type: 'image/png',
			size: 0,
			properties: jsonb({ width, height }),
			storedInternal: false,
			url,
			uri: url,
			isLink: true,
		};
		driveFiles.push(f);
		return f;
	};
	result.remoteUsers.forEach((r, i) => {
		const createdAt = lower - (8 - i * 0.5) * DAY;
		const id = newId(createdAt);
		const software = softwareOf.get(r.host);
		const uri = software === 'mastodon' ? `https://${r.host}/users/${r.username}` : `https://${r.host}/users/${id}`;
		const user = {
			id,
			updatedAt: upperDate,
			lastFetchedAt: new Date(REMOTE_LAST_FETCHED_AT),
			username: r.username,
			usernameLower: r.username.toLowerCase(),
			name: r.name,
			host: r.host,
			inbox: `${uri}/inbox`,
			sharedInbox: `https://${r.host}/inbox`,
			featured: software === 'mastodon' ? `${uri}/collections/featured` : `https://${r.host}/users/${id}/collections/featured`,
			uri,
			followersUri: `${uri}/followers`,
			followersCount: 0,
			followingCount: 0,
			notesCount: 0,
			isBot: false,
		};
		remoteUsers.push(user);
		remoteProfiles.push({
			userId: id,
			userHost: r.host,
			description: rnd.pick(BIOS),
			fields: jsonb(Array.from({ length: rnd.int(0, 2) }, () => ({ name: rnd.pick(FIELD_NAMES), value: rnd.pick(FIELD_VALUES) }))),
			url: `https://${r.host}/@${r.username}`,
		});
		// アバター・バナー・添付用の画像は、ローカルで生成した画像を指すリモートのファイルとして登録する
		const avatarSrc = usableLocalEmojis[(i * 7 + 3) % usableLocalEmojis.length].url;
		const avatar = linkFile(user, createdAt + 1, `avatar-${r.username}.png`, avatarSrc, 128, 128);
		const banner = bannerSources.length > 0
			? linkFile(user, createdAt + 2, `banner-${r.username}.png`, bannerSources[i % bannerSources.length], 1500, 500)
			: null;
		user.attachable = result.photos.length > 0
			? [0, 1].map((k) => linkFile(user, createdAt + 3 + k, `photo-${r.username}-${k + 1}.png`, result.photos[(i * 2 + k) % result.photos.length].url, 800, 600))
			: [];
		const avatarUrl = `${baseUrl}/proxy/avatar.webp?${new URLSearchParams({ url: avatar.url, avatar: '1' })}`;
		avatarUpdates.push([id, avatar.id, avatarUrl, banner?.id ?? null, banner?.url ?? null]);
	});

	// ---- 投稿者 (ローカル 40 人 + リモート 10 人) ----
	const authors = [
		...result.users.map((u) => ({
			id: u.id, host: null, username: u.username, isBot: u.isBot, key: u.username,
			attachable: result.photos.filter((p) => p.userId === u.id).map((p) => ({ id: p.id, type: 'image/png' })),
			emojiNames: usableLocalEmojiNames,
		})),
		...remoteUsers.map((u) => ({
			id: u.id, host: u.host, username: u.username, isBot: false, key: `${u.username}@${u.host}`, uri: u.uri,
			attachable: u.attachable.map((f) => ({ id: f.id, type: f.type })),
			emojiNames: emojiNamesByHost.get(u.host),
		})),
	];
	for (const u of remoteUsers) delete u.attachable;
	const byKey = new Map(authors.map((a) => [a.key, a]));
	const byId = new Map(authors.map((a) => [a.id, a]));

	// ---- ノートの時刻 (人ごとに投稿する時間帯の癖を付ける) ----
	// anchor の前日までの SPAN_DAYS - 1 日に置く。anchor より前なので upper を超えず、切り詰めも要らない
	// 1 人あたりの件数 (平均の 6/7〜8/7 倍) は、API の段で作ったノートも含めた数にする
	const apiNoteCount = new Map();
	for (const n of result.notes ?? []) apiNoteCount.set(n.userId, (apiNoteCount.get(n.userId) ?? 0) + 1);
	const slots = [];
	for (const a of authors) {
		const avg = a.host == null ? localAvg : remoteAvg;
		const count = Math.max(0, rnd.int(Math.round(avg * 6 / 7), Math.round(avg * 8 / 7)) - (apiNoteCount.get(a.id) ?? 0));
		const peakHour = rnd.int(0, 23);
		const spread = 1.5 + rnd.next() * 3.5;
		for (let k = 0; k < count; k++) {
			const day = rnd.int(1, SPAN_DAYS - 1); // anchor の何日前か
			const hour = (((peakHour + gaussian(rnd) * spread) % 24) + 24) % 24;
			// 1 分以内のずれで次の日にはみ出さないよう、その日のうちに収める
			const offset = Math.min(DAY - 1, Math.floor(hour * HOUR + rnd.next() * 60 * 1000));
			slots.push({ author: a, time: anchor - day * DAY + offset });
		}
	}
	slots.sort((x, y) => x.time - y.time);

	// ---- ノートの中身 ----
	const notes = [];
	const noteMeta = new Map(); // id -> { time, isPureRenote, visibility }
	const recentTargets = []; // 公開で、リノートではないノート (リプライ・リノートの相手の候補)
	for (const { author, time } of slots) {
		const id = newId(time);
		const note = {
			id,
			replyId: null,
			renoteId: null,
			text: null,
			cw: null,
			userId: author.id,
			userHost: author.host,
			visibility: 'public',
			localOnly: false,
			renoteCount: 0,
			repliesCount: 0,
			reactions: {},
			uri: null,
			url: null,
			fileIds: [],
			attachedFileTypes: [],
			emojis: [],
			tags: [],
			replyUserId: null,
			replyUserHost: null,
			renoteUserId: null,
			renoteUserHost: null,
			threadId: null,
			reactionAndUserPairCache: [],
		};
		const pickTarget = () => {
			const pool = recentTargets.slice(-RECENT_WINDOW).filter((n) => n.userId !== author.id);
			return pool.length > 0 ? rnd.pick(pool) : null;
		};
		const r = rnd.next();
		let target = null;
		// ボットのリノートは Misskey が renoteCount を数えないので、ボットにはリノートさせない
		if (r < RENOTE_RATE && !author.isBot && (target = pickTarget())) {
			note.renoteId = target.id;
			note.renoteUserId = target.userId;
			note.renoteUserHost = target.userHost;
			target.renoteCount++;
		} else {
			if (r < RENOTE_RATE + REPLY_RATE && (target = pickTarget())) {
				note.replyId = target.id;
				note.replyUserId = target.userId;
				note.replyUserHost = target.userHost;
				note.threadId = target.threadId ?? target.id;
				target.repliesCount++;
			}
			const content = author.host === 'remote-b.example' && rnd.chance(0.15)
				? { text: rnd.pick(REMOTE_EN_TEXTS), cw: null }
				: composeNote(rnd, author.emojiNames);
			note.text = content.text;
			note.cw = content.cw;
			if (author.host == null && note.replyId == null && rnd.chance(0.1)) note.visibility = 'home';
			if (author.attachable.length > 0 && rnd.chance(ATTACH_RATE)) {
				const files = sample(rnd, author.attachable, rnd.int(1, Math.min(4, author.attachable.length)));
				note.fileIds = files.map((f) => f.id);
				note.attachedFileTypes = files.map((f) => f.type);
			}
			note.tags = extractTags(`${note.cw ?? ''} ${note.text}`);
			note.emojis = extractEmojis(`${note.cw ?? ''} ${note.text}`);
		}
		if (author.host != null) {
			const software = softwareOf.get(author.host);
			const isRenote = note.renoteId != null;
			if (software === 'mastodon') {
				note.uri = `${author.uri}/statuses/${id}${isRenote ? '/activity' : ''}`;
				note.url = isRenote ? null : `https://${author.host}/@${author.username}/${id}`;
			} else {
				note.uri = `https://${author.host}/notes/${id}${isRenote ? '/activity' : ''}`;
				note.url = isRenote ? null : note.uri;
			}
		}
		notes.push(note);
		noteMeta.set(id, { time, isPureRenote: note.renoteId != null && note.text == null });
		if (note.renoteId == null && note.visibility === 'public') recentTargets.push(note);
	}

	// ---- リアクション ----
	const reactions = [];
	const reactable = notes.filter((n) => !noteMeta.get(n.id).isPureRenote);
	for (const note of sample(rnd, reactable, Math.round(reactable.length * REACTION_RATE))) {
		const noteTime = noteMeta.get(note.id).time;
		const reactors = sample(rnd, authors.filter((a) => a.id !== note.userId), rnd.int(1, 10));
		for (const reactor of reactors) {
			let reaction;
			if (rnd.chance(0.6)) {
				reaction = normalizeUnicodeReaction(rnd.pick(UNICODE_REACTIONS));
			} else if (reactor.host == null) {
				reaction = `:${rnd.pick(usableLocalEmojiNames)}:`;
			} else {
				reaction = `:${rnd.pick(emojiNamesByHost.get(reactor.host))}@${reactor.host}:`;
			}
			const time = Math.min(upper, noteTime + rnd.int(60 * 1000, 3 * DAY));
			reactions.push({ id: newId(time), userId: reactor.id, noteId: note.id, reaction });
			note.reactions[reaction] = (note.reactions[reaction] ?? 0) + 1;
			if (note.reactionAndUserPairCache.length < PAIR_CACHE_MAX) note.reactionAndUserPairCache.push(`${reactor.id}/${reaction}`);
		}
	}
	for (const n of notes) n.reactions = jsonb(n.reactions);

	// ---- フォロー (リモートが絡むもの) ----
	const remoteOf = new Map(remoteUsers.map((u) => [u.id, u]));
	const followings = [];
	for (const e of result.followEdges.filter((x) => x.scope === 'sql')) {
		const follower = byKey.get(e.follower);
		const followee = byKey.get(e.followee);
		if (!follower || !followee) throw new Error(`フォロー関係のユーザーが見つかりません: ${e.follower} -> ${e.followee}`);
		const fr = remoteOf.get(follower.id);
		const fe = remoteOf.get(followee.id);
		followings.push({
			id: newId(lower + rnd.int(0, (SPAN_DAYS - 1) * DAY - 1)),
			followeeId: followee.id,
			followerId: follower.id,
			followerHost: fr?.host ?? null,
			followerInbox: fr?.inbox ?? null,
			followerSharedInbox: fr?.sharedInbox ?? null,
			followeeHost: fe?.host ?? null,
			followeeInbox: fe?.inbox ?? null,
			followeeSharedInbox: fe?.sharedInbox ?? null,
		});
	}

	// ---- カウンタ ----
	const userDelta = new Map(authors.map((a) => [a.id, { notes: 0, following: 0, followers: 0 }]));
	for (const n of notes) userDelta.get(n.userId).notes++;
	for (const f of followings) {
		userDelta.get(f.followerId).following++;
		userDelta.get(f.followeeId).followers++;
	}
	const instanceByHost = new Map(instances.map((i) => [i.host, i]));
	for (const u of remoteUsers) instanceByHost.get(u.host).usersCount++;
	for (const n of notes) if (n.userHost) instanceByHost.get(n.userHost).notesCount++;
	for (const f of followings) {
		// Misskey と同じく、リモート → ローカルは followingCount、ローカル → リモートは followersCount に数える
		if (f.followerHost && !f.followeeHost) instanceByHost.get(f.followerHost).followingCount++;
		if (!f.followerHost && f.followeeHost) instanceByHost.get(f.followeeHost).followersCount++;
	}
	const userCounterDeltas = [...userDelta.entries()]
		.filter(([, d]) => d.notes || d.following || d.followers)
		.map(([id, d]) => [id, d.notes, d.following, d.followers]);

	// ---- ハッシュタグ ----
	const tagUsers = new Map(); // name -> Set(userId)
	for (const n of notes) {
		for (const tag of n.tags) {
			if (!tagUsers.has(tag)) tagUsers.set(tag, new Set());
			tagUsers.get(tag).add(n.userId);
		}
	}
	const hashtags = [...tagUsers.entries()].map(([name, ids]) => {
		const all = [...ids];
		const local = all.filter((id) => byId.get(id).host == null);
		const remote = all.filter((id) => byId.get(id).host != null);
		return {
			id: newId(upper),
			name,
			mentionedUserIds: all,
			mentionedUsersCount: all.length,
			mentionedLocalUserIds: local,
			mentionedLocalUsersCount: local.length,
			mentionedRemoteUserIds: remote,
			mentionedRemoteUsersCount: remote.length,
		};
	});

	return {
		range: { lower, upper },
		instances, remoteEmojis, remoteUsers, remoteProfiles, driveFiles, avatarUpdates,
		notes, reactions, followings, userCounterDeltas, hashtags,
	};
}

// ---- SQL にする ----

export function renderSql(data) {
	const mergeArray = (col) => `"${col}" = ARRAY(SELECT DISTINCT unnest("hashtag"."${col}" || EXCLUDED."${col}"))`;
	const lines = [
		'BEGIN;',
		'SET LOCAL standard_conforming_strings = on;',
		...insertSql('instance', data.instances),
		...insertSql('user', data.remoteUsers),
		...insertSql('user_profile', data.remoteProfiles),
		...insertSql('drive_file', data.driveFiles),
	];
	for (const [id, avatarId, avatarUrl, bannerId, bannerUrl] of data.avatarUpdates) {
		lines.push(`UPDATE "user" SET "avatarId" = ${sqlValue(avatarId)}, "avatarUrl" = ${sqlValue(avatarUrl)}, "bannerId" = ${sqlValue(bannerId)}, "bannerUrl" = ${sqlValue(bannerUrl)} WHERE id = ${sqlValue(id)};`);
	}
	lines.push(
		...insertSql('emoji', data.remoteEmojis),
		...insertSql('note', data.notes),
		...insertSql('note_reaction', data.reactions),
		...insertSql('following', data.followings),
		...incrementSql('user', ['notesCount', 'followingCount', 'followersCount'], data.userCounterDeltas),
		// API の段で既にあるハッシュタグには、ユーザーを足し合わせる
		...insertSql('hashtag', data.hashtags,
			` ON CONFLICT ("name") DO UPDATE SET ${['mentionedUserIds', 'mentionedLocalUserIds', 'mentionedRemoteUserIds'].map(mergeArray).join(', ')}`),
	);
	if (data.hashtags.length > 0) {
		lines.push(`UPDATE "hashtag" SET "mentionedUsersCount" = cardinality("mentionedUserIds"), "mentionedLocalUsersCount" = cardinality("mentionedLocalUserIds"), "mentionedRemoteUsersCount" = cardinality("mentionedRemoteUserIds") WHERE "name" IN (${data.hashtags.map((h) => sqlValue(h.name)).join(',')});`);
	}
	lines.push('COMMIT;', '');
	return lines.join('\n');
}

// ---- 入口 ----

function parseArgs(argv) {
	const args = { result: null, baseUrl: null, seed: process.env.SEED ?? null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--result') args.result = argv[++i];
		else if (argv[i] === '--base-url') args.baseUrl = argv[++i];
		else if (argv[i] === '--seed') args.seed = argv[++i];
		else throw new Error(`不明な引数です: ${argv[i]}`);
	}
	if (!args.result) throw new Error('使い方: node bulk.mjs --result <seed-result.json> [--base-url <URL>] [--seed N] > bulk.sql');
	return args;
}

function positiveIntEnv(name, fallback) {
	const raw = process.env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} は正の整数で指定してください: ${raw}`);
	return n;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const result = JSON.parse(fs.readFileSync(args.result, 'utf8'));
	const startedAt = Date.now();
	const data = generateBulk(result, {
		seed: args.seed ?? result.seed,
		baseUrl: args.baseUrl ?? result.baseUrl,
		localNotesPerUser: positiveIntEnv('SEED_LOCAL_NOTES', 700),
		remoteNotesPerUser: positiveIntEnv('SEED_REMOTE_NOTES', 700),
	});
	process.stdout.write(renderSql(data));
	const local = data.notes.filter((n) => n.userHost == null).length;
	console.error(`[bulk] SQL を生成しました (${((Date.now() - startedAt) / 1000).toFixed(1)} 秒): ノート ${data.notes.length} 件 (ローカル ${local} / リモート ${data.notes.length - local})、`
		+ `リアクション ${data.reactions.length} 件、フォロー ${data.followings.length} 件、リモートユーザー ${data.remoteUsers.length} 人、ハッシュタグ ${data.hashtags.length} 個`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main();
	} catch (err) {
		console.error(`[bulk] 失敗: ${err.message}`);
		process.exit(1);
	}
}
