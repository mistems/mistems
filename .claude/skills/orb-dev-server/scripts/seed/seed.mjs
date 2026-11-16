/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 開発用シードデータの入口 (API の段)。
//
//   node seed.mjs --url http://localhost:3000 --out <dir> [--seed 20261023] [--admin-password admin1234]
//
// Misskey の HTTP API だけで、ローカルの「骨組み」とやりとりのノートを作る。
// 実行前に、ローカルのユーザーが admin だけであることを確かめる (他にもいれば何もせず終了コード 1)。
// 失敗したら、どの段で何が失敗したかを表示して終了コード 1 で止まる。
//
// 出力: <dir>/seed-result.json (Task 3 の SQL の段が読む)。形は次のとおり。
//   seed            乱数のシード値
//   baseUrl         API を呼んだ URL
//   password        全ユーザー共通のパスワード
//   admin           { id, username, token }
//   roleId          シード用ロールの ID
//   users[]         ローカルの 40 人 (admin を含む)
//                   { id, username, token, name, isBot, followType, avatarFileId, avatarUrl, bannerFileId, bannerUrl }
//                   avatar / banner を設定しなかった人は null
//   remoteUsers[]   リモートの 10 人 (SQL の段で作る): { username, host, name, followType }
//   remoteInstances[] { host, name, softwareName, themeColor }
//   followTypes     { circle, followOnly, followedOnly, isolated }: 型ごとの 50 人のキー配列
//                   キーはローカルが "username"、リモートが "username@host"
//   followEdges[]   { follower, followee, scope }: キーで表した全フォロー関係。
//                   scope が "api" のものはこの段で作成済み、"sql" (リモートが絡むもの) は SQL の段で作る
//   photos[]        添付に使える画像: { id, url, userId, username }。ファイルの持ち主は userId
//   emojis[]        ローカルのカスタム絵文字 100 個: { name, url, fileId, category, aliases, isSensitive, localOnly, license }
//   channels[]      { id, name, ownerUsername }
//   notes[]         API で作ったノート: { id, userId, visibility, kind }
//   counts          作った件数の内訳

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApi } from './lib/api.mjs';
import { createRandom } from './lib/random.mjs';
import { avatarPng, bannerPng, emojiPng, photoPng } from './lib/png.mjs';
import {
	CHANNELS, EMOJI_BASE_NAMES, EMOJI_CATEGORIES, FAMILY_NAMES, FIELD_NAMES, FIELD_VALUES,
	GIVEN_NAMES, BIOS, SHORT_TEXTS, UNICODE_REACTIONS, composeNote,
} from './data/texts.mjs';

const PASSWORD = 'admin1234';
const SETUP_PASSWORD = 'example_password_please_change_this_or_you_will_get_hacked';
const LOCAL_COUNT = 40; // admin + user01..user39
const BOT_USERNAMES = ['user38', 'user39'];
const PHOTO_OWNERS = 10; // 添付画像を持つユーザー数 (先頭から。admin を含む)
const PHOTOS_PER_OWNER = 4;
const EMOJI_COUNT = 100;

const REMOTE_INSTANCES = [
	{ host: 'remote-a.example', name: 'リモートA', softwareName: 'misskey', themeColor: '#86b300' },
	{ host: 'remote-b.example', name: 'リモートB', softwareName: 'mastodon', themeColor: '#6364ff' },
];
const REMOTE_USERS = [
	{ username: 'akari', host: 'remote-a.example', name: 'あかり' },
	{ username: 'bunta', host: 'remote-a.example', name: 'ぶん太' },
	{ username: 'chihiro', host: 'remote-a.example', name: 'ちひろ' },
	{ username: 'daisuke', host: 'remote-a.example', name: '大輔' },
	{ username: 'emi', host: 'remote-a.example', name: 'えみ' },
	{ username: 'fumi', host: 'remote-b.example', name: '文' },
	{ username: 'gen', host: 'remote-b.example', name: '玄' },
	{ username: 'hana', host: 'remote-b.example', name: 'はな' },
	{ username: 'iori', host: 'remote-b.example', name: 'いおり' },
	{ username: 'jun', host: 'remote-b.example', name: '潤' },
];

// フォロー関係の型ごとの人数 (合計 50)
const TYPE_SIZES = { circle: 17, followOnly: 8, followedOnly: 10, isolated: 15 };

function parseArgs(argv) {
	const args = { url: null, out: null, seed: process.env.SEED ?? '20261023', adminPassword: PASSWORD };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--url') args.url = argv[++i];
		else if (argv[i] === '--out') args.out = argv[++i];
		else if (argv[i] === '--seed') args.seed = argv[++i];
		else if (argv[i] === '--admin-password') args.adminPassword = argv[++i];
		else throw new Error(`不明な引数です: ${argv[i]}`);
	}
	if (!args.url || !args.out) throw new Error('使い方: node seed.mjs --url <URL> --out <出力ディレクトリ> [--seed N]');
	return args;
}

const pad2 = (n) => String(n).padStart(2, '0');

let currentStage = '準備';

// 段の開始を表示し、tick で進み具合を出す (50 件ごとと最後)
async function stage(name, total, fn) {
	currentStage = name;
	console.log(`[seed] ${name} 0/${total}`);
	let done = 0;
	const tick = () => {
		done++;
		if (done % 50 === 0 || done === total) console.log(`[seed] ${name} ${done}/${total}`);
	};
	await fn(tick);
}

function shuffle(rnd, items) {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = rnd.int(0, i);
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function sample(rnd, items, n) {
	return shuffle(rnd, items).slice(0, n);
}

// 50 人を 4 つの型に分け、型に沿ったフォロー関係を作る。admin は相互フォローの型に入れる。
function buildFollowGraph(rnd, localKeys, remoteKeys) {
	const others = shuffle(rnd, [...localKeys.filter((k) => k !== 'admin'), ...remoteKeys]);
	const types = { circle: ['admin'], followOnly: [], followedOnly: [], isolated: [] };
	let cursor = 0;
	for (const [type, size] of Object.entries(TYPE_SIZES)) {
		const take = type === 'circle' ? size - 1 : size;
		types[type].push(...others.slice(cursor, cursor + take));
		cursor += take;
	}
	const edges = new Set(); // "follower\tfollowee"
	const add = (a, b) => edges.add(`${a}\t${b}`);
	const has = (a, b) => edges.has(`${a}\t${b}`);

	// 相互フォローの輪: 1 人あたり 4〜10 人と互いにフォローする
	const circle = types.circle;
	const degree = new Map(circle.map((k) => [k, 0]));
	for (const k of circle) {
		const target = rnd.int(4, 10);
		while (degree.get(k) < target) {
			const candidates = circle.filter((o) => o !== k && !has(k, o) && degree.get(o) < 10);
			if (candidates.length === 0) break;
			const o = rnd.pick(candidates);
			add(k, o);
			add(o, k);
			degree.set(k, degree.get(k) + 1);
			degree.set(o, degree.get(o) + 1);
		}
	}
	// フォローしているだけ: 輪の 3〜8 人をフォローする
	for (const k of types.followOnly) {
		for (const o of sample(rnd, circle, rnd.int(3, 8))) add(k, o);
	}
	// フォローされているだけ: 輪の 2〜6 人からフォローされる
	for (const k of types.followedOnly) {
		for (const o of sample(rnd, circle, rnd.int(2, 6))) add(o, k);
	}
	return { types, edges: [...edges].map((e) => e.split('\t')) };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const rnd = createRandom(Number(args.seed) >>> 0);
	const api = createApi(args.url);
	const startedAt = Date.now();

	// ---- 事前確認: ローカルのユーザーが admin だけであること ----
	currentStage = '事前確認';
	const adminLogin = await api.call('signin-flow', { username: 'admin', password: args.adminPassword });
	if (!adminLogin?.finished || !adminLogin.i) throw new Error('admin でサインインできませんでした');
	const adminToken = adminLogin.i;
	// system.proxy などのシステムアカウント (ユーザー名に . を含む) は起動時などに自動で作られるので数えない
	const existing = (await api.call('admin/show-users', { origin: 'local', limit: 100 }, adminToken))
		.filter((u) => !u.username.includes('.'));
	if (existing.length !== 1 || existing[0].username !== 'admin') {
		console.error(`[seed] 既にデータがあります (ローカルのユーザーが ${existing.length} 人います)。`);
		console.error('[seed] 作り直すには、orb-dev.sh down . -v で環境を消してから up し直すか、restore で戻してください。');
		process.exit(1);
	}
	const admin = { id: existing[0].id, username: 'admin', token: adminToken };

	// ---- メタ設定とシード用ロール ----
	await stage('サーバー設定とロール', 3, async (tick) => {
		// リモートのノートを DB から組み立てて出すため、FTT を切る
		await api.call('admin/update-meta', { enableFanoutTimeline: false }, adminToken);
		tick();
		const role = await api.call('admin/roles/create', {
			name: 'シード用',
			description: '開発用シードデータ。レート制限を無効にする',
			color: null,
			iconUrl: null,
			target: 'manual',
			condFormula: { id: crypto.randomUUID(), type: 'and', values: [] },
			isPublic: false,
			isModerator: false,
			isAdministrator: false,
			isExplorable: false,
			asBadge: false,
			canEditMembersByModerator: false,
			displayOrder: 0,
			// クリップは既定で 10 件までなので、admin に 15 件作れるよう上限も上げる
			policies: {
				rateLimitFactor: { useDefault: false, priority: 0, value: 0 },
				clipLimit: { useDefault: false, priority: 0, value: 100 },
				// ノート検索は既定で無効なので、seed の後に検索を確かめられるよう有効にする
				canSearchNotes: { useDefault: false, priority: 0, value: true },
			},
		}, adminToken);
		admin.roleId = role.id;
		tick();
		await api.call('admin/roles/assign', { roleId: role.id, userId: admin.id }, adminToken);
		tick();
	});
	const roleId = admin.roleId;

	// ---- ユーザー ----
	const users = [{ id: admin.id, username: 'admin', token: adminToken, name: 'admin', isBot: false }];
	await stage('ユーザー', LOCAL_COUNT - 1, async (tick) => {
		for (let i = 1; i < LOCAL_COUNT; i++) {
			const username = `user${pad2(i)}`;
			const created = await api.call('admin/accounts/create', { username, password: PASSWORD }, adminToken);
			await api.call('admin/roles/assign', { roleId, userId: created.id }, adminToken);
			users.push({ id: created.id, username, token: created.token, name: username, isBot: BOT_USERNAMES.includes(username) });
			tick();
		}
	});
	const byName = new Map(users.map((u) => [u.username, u]));

	// ---- プロフィール (表示名・自己紹介・fields・アバター・バナー) ----
	await stage('プロフィール', users.length, async (tick) => {
		for (const u of users) {
			// admin と user01 は確認用に、アバターもバナーも必ず付ける
			const forceImages = u.username === 'admin' || u.username === 'user01';
			const wantAvatar = forceImages || !rnd.chance(0.1);
			const wantBanner = forceImages || !rnd.chance(0.1);
			u.avatarFileId = u.avatarUrl = u.bannerFileId = u.bannerUrl = null;
			if (wantAvatar) {
				const f = await api.upload(u.token, `avatar-${u.username}.png`, avatarPng(`avatar-${u.username}`));
				u.avatarFileId = f.id;
				u.avatarUrl = f.url;
			}
			if (wantBanner) {
				const f = await api.upload(u.token, `banner-${u.username}.png`, bannerPng(`banner-${u.username}`));
				u.bannerFileId = f.id;
				u.bannerUrl = f.url;
			}
			const fields = Array.from({ length: rnd.int(0, 3) }, () => ({ name: rnd.pick(FIELD_NAMES), value: rnd.pick(FIELD_VALUES) }));
			const body = {
				description: rnd.pick(BIOS),
				fields,
				isBot: u.isBot,
			};
			if (u.username !== 'admin') {
				u.name = `${rnd.pick(FAMILY_NAMES)} ${rnd.pick(GIVEN_NAMES)}`;
				body.name = u.name;
			}
			if (u.avatarFileId) body.avatarId = u.avatarFileId;
			if (u.bannerFileId) body.bannerId = u.bannerFileId;
			await api.call('i/update', body, u.token);
			tick();
		}
	});

	// ---- 初期設定 (ログイン直後の MkUserSetupDialog) を済ませた状態にする ----
	// frontend の store (Pizzax 'base') の accountSetupWizard はアカウントのレジストリに保存され、-1 が「完了」
	await stage('初期設定の完了', users.length, async (tick) => {
		for (const u of users) {
			await api.call('i/registry/set', { scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 }, u.token);
			tick();
		}
	});

	// ---- 添付用の画像 ----
	const photos = [];
	await stage('添付用の画像', PHOTO_OWNERS * PHOTOS_PER_OWNER, async (tick) => {
		for (const u of users.slice(0, PHOTO_OWNERS)) {
			for (let k = 0; k < PHOTOS_PER_OWNER; k++) {
				const f = await api.upload(u.token, `photo-${u.username}-${k + 1}.png`, photoPng(`photo-${u.username}-${k + 1}`));
				photos.push({ id: f.id, url: f.url, userId: u.id, username: u.username });
				tick();
			}
		}
	});

	// ---- カスタム絵文字 ----
	const emojis = [];
	await stage('カスタム絵文字', EMOJI_COUNT, async (tick) => {
		for (let i = 0; i < EMOJI_COUNT; i++) {
			const name = `${EMOJI_BASE_NAMES[i % EMOJI_BASE_NAMES.length]}_${pad2(i + 1)}`;
			// 最後の 6 個はカテゴリなし
			const category = i >= EMOJI_COUNT - 6 ? null : EMOJI_CATEGORIES[i % EMOJI_CATEGORIES.length];
			const aliases = Array.from({ length: rnd.int(0, 2) }, (_, k) => `${name.split('_')[0]}${k + 1}`);
			const isSensitive = i === 13 || i === 57;
			const localOnly = i === 28 || i === 71;
			const license = i % 25 === 3 ? `CC0 (シード用の生成画像 ${name})` : null;
			const f = await api.upload(adminToken, `emoji-${name}.png`, emojiPng(`emoji-${name}`));
			await api.call('admin/emoji/add', { name, fileId: f.id, category, aliases, license, isSensitive, localOnly }, adminToken);
			emojis.push({ name, url: f.url, fileId: f.id, category, aliases, isSensitive, localOnly, license });
			tick();
		}
	});
	// 本文やリアクションに使うのは、センシティブでもローカルのみでもないもの
	const usableEmojiNames = emojis.filter((e) => !e.isSensitive).map((e) => e.name);

	// ---- フォロー関係 ----
	const localKeys = users.map((u) => u.username);
	const remoteKeys = REMOTE_USERS.map((r) => `${r.username}@${r.host}`);
	const { types: followTypes, edges } = buildFollowGraph(rnd, localKeys, remoteKeys);
	const isLocalKey = (k) => !k.includes('@');
	const followEdges = edges.map(([follower, followee]) => ({
		follower, followee, scope: isLocalKey(follower) && isLocalKey(followee) ? 'api' : 'sql',
	}));
	const apiEdges = followEdges.filter((e) => e.scope === 'api');
	await stage('フォロー', apiEdges.length, async (tick) => {
		for (const e of apiEdges) {
			await api.call('following/create', { userId: byName.get(e.followee).id }, byName.get(e.follower).token);
			tick();
		}
	});
	const typeOf = new Map();
	for (const [type, keys] of Object.entries(followTypes)) for (const k of keys) typeOf.set(k, type);
	for (const u of users) u.followType = typeOf.get(u.username);

	// ---- チャンネル ----
	const channels = [];
	await stage('チャンネル', CHANNELS.length, async (tick) => {
		for (let i = 0; i < CHANNELS.length; i++) {
			const owner = users[i + 1];
			const c = await api.call('channels/create', { ...CHANNELS[i] }, owner.token);
			channels.push({ id: c.id, name: CHANNELS[i].name, ownerUsername: owner.username });
			tick();
		}
		await api.call('channels/follow', { channelId: channels[0].id }, adminToken);
		await api.call('channels/follow', { channelId: channels[1].id }, adminToken);
		await api.call('channels/favorite', { channelId: channels[2].id }, adminToken);
	});

	// ---- ノート ----
	const notes = []; // { id, userId, username, visibility, kind }
	// リプライ・リアクション・クリップなどの対象。リノート (テキストなし) は対象にできないので除く
	const publicNotes = () => notes.filter((n) => (n.visibility === 'public' || n.visibility === 'home') && n.kind !== 'renote');
	const counts = {};
	const post = async (author, body, kind, visibility = body.visibility ?? 'public') => {
		const res = await api.call('notes/create', body, author.token);
		const n = { id: res.createdNote.id, userId: author.id, username: author.username, visibility, kind };
		notes.push(n);
		counts[kind] = (counts[kind] ?? 0) + 1;
		return n;
	};
	const mentionPrefix = () => (rnd.chance(0.15) ? `@${rnd.pick(users).username} ` : '');
	const compose = () => composeNote(rnd, usableEmojiNames);

	const channelCounts = channels.map(() => rnd.int(20, 40));
	const plan = {
		plain: 130, followers: 20, specified: 15, image: 40, reply: 70, renote: 30, quote: 15,
		channel: channelCounts.reduce((a, b) => a + b, 0), poll: 10,
	};
	const noteTotal = Object.values(plan).reduce((a, b) => a + b, 0);
	await stage('ノート', noteTotal, async (tick) => {
		// 普通のノート (公開 85%、ホーム 15%)
		for (let i = 0; i < plan.plain; i++) {
			const u = rnd.pick(users);
			const { text, cw } = compose();
			await post(u, { text: mentionPrefix() + text, cw, visibility: rnd.chance(0.15) ? 'home' : 'public' }, 'plain');
			tick();
		}
		// フォロワー限定
		for (let i = 0; i < plan.followers; i++) {
			const u = rnd.pick(users);
			await post(u, { text: compose().text, visibility: 'followers' }, 'followers');
			tick();
		}
		// 指名
		for (let i = 0; i < plan.specified; i++) {
			const u = rnd.pick(users);
			const targets = sample(rnd, users.filter((o) => o.id !== u.id), rnd.int(1, 2));
			await post(u, {
				text: `@${targets[0].username} ${rnd.pick(SHORT_TEXTS)}`,
				visibility: 'specified',
				visibleUserIds: targets.map((t) => t.id),
			}, 'specified');
			tick();
		}
		// 画像つき (自分の画像だけ使える)
		for (let i = 0; i < plan.image; i++) {
			const owner = users[rnd.int(0, PHOTO_OWNERS - 1)];
			const own = photos.filter((p) => p.userId === owner.id);
			const fileIds = sample(rnd, own, rnd.int(1, PHOTOS_PER_OWNER)).map((p) => p.id);
			await post(owner, { text: compose().text, fileIds, visibility: 'public' }, 'image');
			tick();
		}
		// リプライ (先に作った公開・ホームのノートに返す。返信への返信でスレッドになる)
		for (let i = 0; i < plan.reply; i++) {
			const target = rnd.pick(publicNotes());
			const u = rnd.pick(users);
			await post(u, { text: `@${target.username} ${rnd.pick(SHORT_TEXTS)}`, replyId: target.id, visibility: 'public' }, 'reply');
			tick();
		}
		// リノート (テキストなし)
		for (let i = 0; i < plan.renote; i++) {
			const target = rnd.pick(publicNotes());
			const u = rnd.pick(users.filter((o) => o.id !== target.userId));
			await post(u, { renoteId: target.id, visibility: 'public' }, 'renote');
			tick();
		}
		// 引用リノート
		for (let i = 0; i < plan.quote; i++) {
			const target = rnd.pick(publicNotes());
			const u = rnd.pick(users);
			await post(u, { text: rnd.pick(SHORT_TEXTS), renoteId: target.id, visibility: 'public' }, 'quote');
			tick();
		}
		// チャンネルへの投稿
		for (let c = 0; c < channels.length; c++) {
			for (let i = 0; i < channelCounts[c]; i++) {
				const u = rnd.pick(users);
				await post(u, { text: compose().text, channelId: channels[c].id, visibility: 'public' }, 'channel');
				tick();
			}
		}
		// アンケート (1 件目は締め切り 2 分後、2 件目は 1 日後、残りは締め切りなし)
		const pollNotes = [];
		for (let i = 0; i < plan.poll; i++) {
			const u = rnd.pick(users);
			const choices = ['はい', 'いいえ', 'どちらでもない', 'わからない'].slice(0, rnd.int(2, 4));
			const poll = { choices, multiple: i % 3 === 2 };
			if (i === 0) poll.expiredAfter = 2 * 60 * 1000;
			else if (i === 1) poll.expiredAfter = 24 * 60 * 60 * 1000;
			const n = await post(u, { text: `アンケート ${i + 1}: どう思いますか？`, poll, visibility: 'public' }, 'poll');
			pollNotes.push({ note: n, choiceCount: choices.length });
			tick();
		}
		// 投票 (投稿者以外の 3〜8 人)
		for (const { note, choiceCount } of pollNotes) {
			for (const v of sample(rnd, users.filter((o) => o.id !== note.userId), rnd.int(3, 8))) {
				await api.call('notes/polls/vote', { noteId: note.id, choice: rnd.int(0, choiceCount - 1) }, v.token);
			}
		}
	});

	// ---- リアクション ----
	const reactable = publicNotes();
	const reactTargets = sample(rnd, reactable, Math.round(reactable.length * 0.3));
	await stage('リアクション', reactTargets.length, async (tick) => {
		for (const n of reactTargets) {
			for (const u of sample(rnd, users.filter((o) => o.id !== n.userId), rnd.int(1, 6))) {
				const reaction = rnd.chance(0.6) ? rnd.pick(UNICODE_REACTIONS) : `:${rnd.pick(usableEmojiNames)}:`;
				await api.call('notes/reactions/create', { noteId: n.id, reaction }, u.token);
			}
			tick();
		}
	});

	// ---- クリップとお気に入り ----
	await stage('クリップとお気に入り', 15 + 2 + 10, async (tick) => {
		const pub = publicNotes();
		for (let i = 0; i < 15; i++) {
			const clip = await api.call('clips/create', {
				name: `クリップ ${pad2(i + 1)}`,
				description: i % 2 === 0 ? 'シード用のクリップです' : null,
				isPublic: i % 3 !== 0,
			}, adminToken);
			// 3 件にだけノートを入れる
			if (i < 3) {
				for (const n of sample(rnd, pub, rnd.int(5, 10))) {
					await api.call('clips/add-note', { clipId: clip.id, noteId: n.id }, adminToken);
				}
			}
			tick();
		}
		const user01 = byName.get('user01');
		for (let i = 0; i < 2; i++) {
			const clip = await api.call('clips/create', { name: `user01 のクリップ ${i + 1}`, isPublic: true }, user01.token);
			await api.call('clips/favorite', { clipId: clip.id }, adminToken);
			tick();
		}
		for (const n of sample(rnd, pub, 10)) {
			await api.call('notes/favorites/create', { noteId: n.id }, adminToken);
			tick();
		}
	});

	// ---- リストとアンテナ ----
	await stage('リストとアンテナ', 3, async (tick) => {
		for (let i = 0; i < 2; i++) {
			const list = await api.call('users/lists/create', { name: `リスト ${i + 1}` }, adminToken);
			for (const u of sample(rnd, users.filter((o) => o.username !== 'admin'), rnd.int(5, 8))) {
				await api.call('users/lists/push', { listId: list.id, userId: u.id }, adminToken);
			}
			tick();
		}
		await api.call('antennas/create', {
			name: 'コーヒーと猫',
			src: 'all',
			userListId: null,
			keywords: [['コーヒー'], ['猫']],
			excludeKeywords: [],
			users: [],
			caseSensitive: false,
			localOnly: false,
			excludeBots: false,
			withReplies: false,
			withFile: false,
		}, adminToken);
		tick();
	});

	// ---- 検証: ローカルどうしのフォロー数がグラフどおりか ----
	await stage('検証', users.length, async (tick) => {
		for (const u of users) {
			const detail = await api.call('users/show', { userId: u.id }, adminToken);
			const expFollowing = apiEdges.filter((e) => e.follower === u.username).length;
			const expFollowers = apiEdges.filter((e) => e.followee === u.username).length;
			if (detail.followingCount !== expFollowing || detail.followersCount !== expFollowers) {
				throw new Error(`${u.username} のフォロー数が合いません (following ${detail.followingCount}/${expFollowing}, followers ${detail.followersCount}/${expFollowers})`);
			}
			tick();
		}
	});

	// ---- 結果の書き出し ----
	currentStage = '結果の書き出し';
	fs.mkdirSync(args.out, { recursive: true });
	const result = {
		seed: args.seed,
		baseUrl: args.url,
		password: PASSWORD,
		admin: { id: admin.id, username: 'admin', token: adminToken },
		roleId,
		users: users.map((u) => ({
			id: u.id, username: u.username, token: u.token, name: u.name, isBot: u.isBot, followType: u.followType,
			avatarFileId: u.avatarFileId, avatarUrl: u.avatarUrl, bannerFileId: u.bannerFileId, bannerUrl: u.bannerUrl,
		})),
		remoteUsers: REMOTE_USERS.map((r) => ({ ...r, followType: typeOf.get(`${r.username}@${r.host}`) })),
		remoteInstances: REMOTE_INSTANCES,
		followTypes,
		followEdges,
		photos,
		emojis,
		channels,
		notes: notes.map(({ id, userId, visibility, kind }) => ({ id, userId, visibility, kind })),
		counts,
	};
	fs.writeFileSync(path.join(args.out, 'seed-result.json'), JSON.stringify(result, null, '\t'));
	console.log(`[seed] 完了: ${path.join(args.out, 'seed-result.json')} (${((Date.now() - startedAt) / 1000).toFixed(1)} 秒、ノート ${notes.length} 件)`);
}

main().catch((err) => {
	console.error(`[seed] 失敗: 「${currentStage}」の段で止まりました: ${err.message}`);
	process.exit(1);
});
