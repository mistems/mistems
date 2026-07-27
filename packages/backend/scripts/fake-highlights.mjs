/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * ハイライト用のテストデータを捏造するスクリプト。
 *
 * 実行方法:
 *   cd packages/backend
 *   node scripts/fake-highlights.mjs
 *
 * - ローカルユーザーが足りなければダミーを追加生成
 * - 直近のローカル/public/ルートノート 13件を対象に
 *   赤3件(>=highlightHighPopularityThreshold)
 *   青5件(highlightMidPopularityThreshold <= n < high)
 *   通常5件 (low)
 *   になるよう note_reaction を補充
 * - Redis の featuredGlobalNotesRanking に登録
 */

import Redis from 'ioredis';
import { generateKeyPair, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { loadConfig } from '../src-js/config.js';
import { createPostgresDataSource } from '../src-js/postgres.js';
import { genAidx } from '../src-js/misc/id/aidx.js';

const generateKeyPairAsync = promisify(generateKeyPair);

const RED_COUNT = 3;
const BLUE_COUNT = 5;
const NORMAL_COUNT = 5;
const TOTAL_NOTES = RED_COUNT + BLUE_COUNT + NORMAL_COUNT;

const EMOJIS = ['❤', '👍', '🍣', '🎉', '😆', '🥳', '✨', '🚀', '🌸', '🍰'];

const FAVSTAR_USER_PREFIX = 'fav_test_';

const featuredEpoc = new Date('2023-01-01T00:00:00Z').getTime();
const GLOBAL_NOTES_RANKING_WINDOW = 1000 * 60 * 60 * 24 * 3;

function pickEmoji(i) {
	return EMOJIS[i % EMOJIS.length];
}

function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

async function createDummyUser(ds, idx) {
	const id = genAidx(Date.now());
	const username = `${FAVSTAR_USER_PREFIX}${id}`;
	const usernameLower = username.toLowerCase();
	const token = randomBytes(8).toString('hex');

	const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});

	await ds.transaction(async (manager) => {
		await manager.query(
			`INSERT INTO "user" (
				"id","username","usernameLower","host","token","name"
			) VALUES ($1,$2,$3,NULL,$4,$5)`,
			[id, username, usernameLower, token, `Favstar Test ${idx}`],
		);
		await manager.query(
			`INSERT INTO "user_profile" ("userId") VALUES ($1)`,
			[id],
		);
		await manager.query(
			`INSERT INTO "user_keypair" ("userId","publicKey","privateKey") VALUES ($1,$2,$3)`,
			[id, publicKey, privateKey],
		);
	});

	return id;
}

async function ensureLocalUsers(ds, needed) {
	const existing = await ds.query(
		`SELECT "id" FROM "user" WHERE "host" IS NULL AND "isSuspended" = false AND "isDeleted" = false ORDER BY "id" DESC LIMIT $1`,
		[Math.max(needed * 2, 20)],
	);
	let userIds = existing.map((r) => r.id);

	const deficit = needed - userIds.length;
	if (deficit > 0) {
		console.log(`既存ローカルユーザーが ${userIds.length} 人。あと ${deficit} 人ダミー作成します...`);
		for (let i = 0; i < deficit; i++) {
			const id = await createDummyUser(ds, userIds.length + 1);
			userIds.push(id);
			console.log(`  → 作成: ${id}`);
		}
	} else {
		console.log(`既存ローカルユーザー ${userIds.length} 人を再利用します`);
	}

	return userIds;
}

const SAMPLE_NOTE_TEXTS = [
	'今日はいい天気だね',
	'ラーメン食べたい🍜',
	'眠い…',
	'コードレビューしてる',
	'おはよう☀️',
	'おやすみ🌙',
	'お腹すいた',
	'コーヒーうまい☕',
	'仕事終わった〜',
	'映画観たい',
	'桜が綺麗',
	'もうこんな時間',
	'今日もお疲れ様',
	'ねむい',
	'お風呂入る',
	'ご飯炊けた',
	'散歩日和',
	'ニャーン🐱',
	'本読んでる📚',
	'バグった',
];

async function createSampleNotes(ds, userIds, count) {
	const created = [];
	for (let i = 0; i < count; i++) {
		const id = genAidx(Date.now() - i * 1000);
		const userId = userIds[i % userIds.length];
		const text = `${SAMPLE_NOTE_TEXTS[i % SAMPLE_NOTE_TEXTS.length]} (#${i + 1})`;
		await ds.query(
			`INSERT INTO "note" ("id","userId","visibility","text") VALUES ($1,$2,'public',$3)`,
			[id, userId, text],
		);
		created.push({ id, userId, reactions: {} });
		console.log(`  → note作成: ${id} (${text})`);
	}
	return created;
}

async function fetchCandidateNotes(ds) {
	const sinceAidx = genAidx(Date.now() - 1000 * 60 * 60 * 24 * 2);

	let notes = await ds.query(
		`SELECT "id","userId","reactions"
		 FROM "note"
		 WHERE "visibility" = 'public'
			AND "userHost" IS NULL
			AND "replyId" IS NULL
			AND "id" > $1
		 ORDER BY "id" DESC
		 LIMIT $2`,
		[sinceAidx, TOTAL_NOTES * 2],
	);

	if (notes.length < TOTAL_NOTES) {
		console.log(`2日以内のノートが ${notes.length} 件しかないので、3日以内に拡張します`);
		const sinceAidx3d = genAidx(Date.now() - 1000 * 60 * 60 * 24 * 3);
		notes = await ds.query(
			`SELECT "id","userId","reactions"
			 FROM "note"
			 WHERE "visibility" = 'public'
				AND "userHost" IS NULL
				AND "replyId" IS NULL
				AND "id" > $1
			 ORDER BY "id" DESC
			 LIMIT $2`,
			[sinceAidx3d, TOTAL_NOTES * 2],
		);
	}

	if (notes.length < TOTAL_NOTES) {
		console.warn(`⚠️  対象ノートが ${notes.length} 件しかありません。先にローカル公開ノートを ${TOTAL_NOTES} 件以上投稿してください。`);
	}

	return notes.slice(0, TOTAL_NOTES);
}

async function getMetaThresholds(ds) {
	const rows = await ds.query(
		`SELECT "highlightMidPopularityThreshold","highlightHighPopularityThreshold" FROM "meta" LIMIT 1`,
	);
	if (rows.length === 0) {
		return { mid: 3, high: 5 };
	}
	return {
		mid: rows[0].highlightMidPopularityThreshold ?? 3,
		high: rows[0].highlightHighPopularityThreshold ?? 5,
	};
}

async function addReactions(ds, note, userIds, targetCount, emojiBase) {
	const reactions = note.reactions ?? {};
	const currentTotal = Object.values(reactions).reduce((a, b) => a + Number(b), 0);
	const need = Math.max(0, targetCount - currentTotal);
	if (need === 0) return 0;

	const eligible = userIds.filter((uid) => uid !== note.userId);
	if (eligible.length < need) {
		console.warn(`  ノート ${note.id}: ユーザーが足りません (${eligible.length} < ${need})`);
	}
	const picks = shuffle(eligible).slice(0, need);

	let added = 0;
	for (let i = 0; i < picks.length; i++) {
		const userId = picks[i];
		const reaction = pickEmoji(emojiBase + i);
		const rid = genAidx(Date.now());
		try {
			await ds.transaction(async (manager) => {
				await manager.query(
					`INSERT INTO "note_reaction" ("id","userId","noteId","reaction") VALUES ($1,$2,$3,$4)`,
					[rid, userId, note.id, reaction],
				);
				await manager.query(
					`UPDATE "note"
					 SET "reactions" = jsonb_set("reactions", ARRAY[$1::text], (COALESCE("reactions"->>$1, '0')::int + 1)::text::jsonb)
					 WHERE "id" = $2`,
					[reaction, note.id],
				);
			});
			added++;
		} catch (e) {
			// note_reactionの(userId,noteId) unique衝突は無視（同ユーザーが既にリアクション済み）
			if (!String(e.message).includes('duplicate key')) {
				console.warn(`  reaction insert失敗: ${e.message}`);
			}
		}
	}
	return added;
}

async function main() {
	const config = loadConfig();
	console.log(`DB: ${config.db.host}:${config.db.port}/${config.db.db}`);
	console.log(`Redis: ${config.redis.host}:${config.redis.port} (prefix=${config.redis.keyPrefix})`);

	const ds = createPostgresDataSource(config);
	await ds.initialize();

	const redis = new Redis({
		host: config.redis.host,
		port: config.redis.port,
		family: config.redis.family,
		password: config.redis.pass,
		db: config.redis.db,
		keyPrefix: config.redis.keyPrefix,
	});

	try {
		const thresholds = await getMetaThresholds(ds);
		console.log(`閾値: mid=${thresholds.mid}, high=${thresholds.high}`);

		const userIds = await ensureLocalUsers(ds, Math.max(thresholds.high + 2, 8));

		let notes = await fetchCandidateNotes(ds);
		const noteDeficit = TOTAL_NOTES - notes.length;
		if (noteDeficit > 0) {
			console.log(`対象ノートが ${notes.length} 件しかないので、サンプルノートを ${noteDeficit} 件作成します`);
			const created = await createSampleNotes(ds, userIds, noteDeficit);
			notes = [...created, ...notes];
		}
		console.log(`対象ノート ${notes.length} 件`);

		// 配列の前から赤→青→通常の順に当てる
		const plan = [];
		for (let i = 0; i < RED_COUNT; i++) plan.push({ kind: 'red', target: thresholds.high + 1 + (i % 3) });
		for (let i = 0; i < BLUE_COUNT; i++) plan.push({ kind: 'blue', target: thresholds.mid + (i % Math.max(1, thresholds.high - thresholds.mid)) });
		for (let i = 0; i < NORMAL_COUNT; i++) plan.push({ kind: 'normal', target: Math.max(0, thresholds.mid - 1 - (i % 2)) });

		let emojiBase = 0;
		const featuredItems = [];
		for (let i = 0; i < notes.length && i < plan.length; i++) {
			const { kind, target } = plan[i];
			const added = await addReactions(ds, notes[i], userIds, target, emojiBase);
			emojiBase += added;
			featuredItems.push({ noteId: notes[i].id, kind, target });
			console.log(`  [${kind}] note=${notes[i].id} target=${target} added=${added}`);
		}

		// Redis ランキング登録
		const currentWindow = Math.floor((Date.now() - featuredEpoc) / GLOBAL_NOTES_RANKING_WINDOW);
		const key = `featuredGlobalNotesRanking:${currentWindow}`;
		console.log(`Redis ZADD → ${config.redis.keyPrefix}${key}`);
		const tx = redis.multi();
		for (let i = 0; i < featuredItems.length; i++) {
			const item = featuredItems[i];
			const score = (item.kind === 'red' ? 30 : item.kind === 'blue' ? 15 : 5) + (featuredItems.length - i);
			tx.zadd(key, score, item.noteId);
		}
		tx.expire(key, Math.floor((GLOBAL_NOTES_RANKING_WINDOW * 3) / 1000), 'NX');
		await tx.exec();

		console.log('✅ ハイライト捏造完了');
		console.log(`  赤: ${featuredItems.filter((x) => x.kind === 'red').length} 件`);
		console.log(`  青: ${featuredItems.filter((x) => x.kind === 'blue').length} 件`);
		console.log(`  通常: ${featuredItems.filter((x) => x.kind === 'normal').length} 件`);
	} finally {
		await ds.destroy();
		redis.disconnect();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
