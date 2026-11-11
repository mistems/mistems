/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePng, avatarPng, bannerPng, emojiPng, photoPng } from './lib/png.mjs';
import { genAidx } from './lib/aidx.mjs';
import { createRandom } from './lib/random.mjs';
import { generateBulk, renderSql, sqlLiteral } from './bulk.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('encodePng: シグネチャと IHDR の幅・高さ', () => {
	const png = encodePng(3, 2, new Uint8Array(3 * 2 * 4));
	assert.deepEqual(png.subarray(0, 8), SIGNATURE);
	assert.equal(png.toString('latin1', 12, 16), 'IHDR');
	assert.equal(png.readUInt32BE(16), 3);
	assert.equal(png.readUInt32BE(20), 2);
	assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
});

test('各生成関数: 指定サイズで、同じシードなら同じバイト列', () => {
	const cases = [
		[avatarPng, 256, 256],
		[bannerPng, 1500, 500],
		[emojiPng, 128, 128],
		[photoPng, 800, 600],
	];
	for (const [fn, w, h] of cases) {
		const a = fn('user01');
		assert.deepEqual(a.subarray(0, 8), SIGNATURE);
		assert.equal(a.readUInt32BE(16), w);
		assert.equal(a.readUInt32BE(20), h);
		assert.deepEqual(a, fn('user01'));
		assert.notDeepEqual(a, fn('user02'));
	}
});

test('genAidx: 16 文字で先頭 8 文字は時刻の 36 進数', () => {
	const id = genAidx(946684800000 + 36 ** 3, 0);
	assert.equal(id.length, 16);
	assert.equal(id.slice(0, 8), '00001000');
	assert.match(id, /^[0-9a-z]{16}$/);
	assert.equal(id.slice(12), '0000');
	assert.equal(genAidx(946684800000, 36).slice(12), '0010');
});

test('genAidx: node 部はプロセス内で固定', () => {
	assert.equal(genAidx(946684800000, 1).slice(8, 12), genAidx(946684800000, 2).slice(8, 12));
});

test('createRandom: 同じシードで同じ列、範囲内の値を返す', () => {
	const a = createRandom(20261023);
	const b = createRandom(20261023);
	const seqA = Array.from({ length: 20 }, () => a.next());
	const seqB = Array.from({ length: 20 }, () => b.next());
	assert.deepEqual(seqA, seqB);
	const r = createRandom(1);
	for (let i = 0; i < 200; i++) {
		const v = r.int(3, 5);
		assert.ok(v >= 3 && v <= 5 && Number.isInteger(v));
		assert.ok(['x', 'y'].includes(r.pick(['x', 'y'])));
		assert.equal(typeof r.chance(0.5), 'boolean');
	}
});

// ---- bulk.mjs (SQL の段) ----

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const aidxTime = (id) => parseInt(id.slice(0, 8), 36) + 946684800000;

// seed-result.json と同じ形の小さな入力を作る (ローカル 40 人、リモート 10 人)
function fakeResult() {
	const base = 'http://localhost:3000';
	const users = Array.from({ length: 40 }, (_, i) => {
		const username = i === 0 ? 'admin' : `user${String(i).padStart(2, '0')}`;
		const hasImages = i % 10 !== 9;
		return {
			id: genAidx(NOW - DAY, i + 1), username, token: `token${i}`, name: username, isBot: i >= 38,
			followType: 'isolated',
			avatarFileId: hasImages ? genAidx(NOW - DAY, 100 + i) : null, avatarUrl: hasImages ? `${base}/files/avatar-${i}` : null,
			bannerFileId: hasImages ? genAidx(NOW - DAY, 200 + i) : null, bannerUrl: hasImages ? `${base}/files/banner-${i}` : null,
		};
	});
	const remoteUsers = ['akari', 'bunta', 'chihiro', 'daisuke', 'emi', 'fumi', 'gen', 'hana', 'iori', 'jun'].map((username, i) => ({
		username, host: i < 5 ? 'remote-a.example' : 'remote-b.example', name: username, followType: 'isolated',
	}));
	const photos = users.slice(0, 10).flatMap((u, i) => Array.from({ length: 4 }, (_, k) => ({
		id: genAidx(NOW - DAY, 300 + i * 4 + k), url: `${base}/files/photo-${i}-${k}`, userId: u.id, username: u.username,
	})));
	const emojis = Array.from({ length: 20 }, (_, i) => ({
		name: `emo_${String(i + 1).padStart(2, '0')}`, url: `${base}/files/emoji-${i}`, fileId: genAidx(NOW - DAY, 400 + i),
		category: null, aliases: [], isSensitive: i === 3, localOnly: false, license: null,
	}));
	const followEdges = [
		{ follower: 'admin', followee: 'user01', scope: 'api' },
		{ follower: 'admin', followee: 'akari@remote-a.example', scope: 'sql' },
		{ follower: 'akari@remote-a.example', followee: 'admin', scope: 'sql' },
		{ follower: 'fumi@remote-b.example', followee: 'user02', scope: 'sql' },
		{ follower: 'gen@remote-b.example', followee: 'akari@remote-a.example', scope: 'sql' },
	];
	return {
		seed: '20261023', baseUrl: base, users, remoteUsers,
		remoteInstances: [
			{ host: 'remote-a.example', name: 'リモートA', softwareName: 'misskey', themeColor: '#86b300' },
			{ host: 'remote-b.example', name: 'リモートB', softwareName: 'mastodon', themeColor: '#6364ff' },
		],
		followEdges, photos, emojis,
		// API の段のノート (admin に 30 件)
		notes: Array.from({ length: 30 }, (_, i) => ({ id: genAidx(NOW - 60 * 1000, 900 + i), userId: users[0].id, visibility: 'public', kind: 'plain' })),
	};
}

const bulkOpts = { seed: 20261023, now: NOW, baseUrl: 'http://localhost:3000' };

test('bulk: sqlLiteral は \' を重ねてエスケープする', () => {
	assert.equal(sqlLiteral("It's"), "'It''s'");
	assert.equal(sqlLiteral("''"), "''''''");
	assert.equal(sqlLiteral(null), 'NULL');
});

test('bulk: 1 つのトランザクションで、リモートユーザー 10 人・ホスト 2 種類', () => {
	const data = generateBulk(fakeResult(), bulkOpts);
	const sql = renderSql(data);
	assert.ok(sql.startsWith('BEGIN;'));
	assert.ok(sql.trimEnd().endsWith('COMMIT;'));
	assert.equal(data.remoteUsers.length, 10);
	assert.equal(new Set(data.remoteUsers.map((u) => u.host)).size, 2);
	const userInserts = sql.split('\n').filter((l) => l.startsWith('INSERT INTO "user" '));
	assert.equal(userInserts.length, 1);
	for (const u of data.remoteUsers) assert.ok(userInserts[0].includes(sqlLiteral(u.id)));
	assert.ok(sql.includes(sqlLiteral('remote-a.example')) && sql.includes(sqlLiteral('remote-b.example')));
});

test('bulk: 複数行 INSERT は 1 文あたり 1000 行まで', () => {
	const sql = renderSql(generateBulk(fakeResult(), bulkOpts));
	for (const line of sql.split('\n').filter((l) => l.startsWith('INSERT INTO'))) {
		const rows = line.split('),(').length;
		assert.ok(rows <= 1000, `${rows} 行の INSERT がある`);
	}
});

test('bulk: ノートの時刻は過去 180 日に収まり、ローカルの各ユーザーは 600〜800 件', () => {
	const result = fakeResult();
	const data = generateBulk(result, bulkOpts);
	const firstApiNote = Math.min(...result.notes.map((n) => aidxTime(n.id)));
	for (const n of data.notes) {
		const t = aidxTime(n.id);
		assert.ok(t > NOW - 180 * DAY && t < firstApiNote, `範囲外の時刻: ${new Date(t).toISOString()}`);
	}
	// API の段のノートも含めて数える
	const perUser = new Map();
	for (const n of [...data.notes, ...result.notes]) perUser.set(n.userId, (perUser.get(n.userId) ?? 0) + 1);
	for (const u of result.users) {
		const c = perUser.get(u.id) ?? 0;
		assert.ok(c >= 600 && c <= 800, `${u.username}: ${c} 件`);
	}
	for (const r of data.remoteUsers) {
		const c = perUser.get(r.id) ?? 0;
		assert.ok(c >= 600 && c <= 800, `${r.username}@${r.host}: ${c} 件`);
	}
});

test('bulk: リプライ先・リノート先は自分より前の時刻のノートで、リノートにはリアクションしない', () => {
	const data = generateBulk(fakeResult(), bulkOpts);
	const byId = new Map(data.notes.map((n) => [n.id, n]));
	let replies = 0;
	let renotes = 0;
	for (const n of data.notes) {
		for (const targetId of [n.replyId, n.renoteId].filter(Boolean)) {
			const target = byId.get(targetId);
			assert.ok(target, '対象が SQL の段のノートにない');
			assert.ok(target.id < n.id && aidxTime(target.id) <= aidxTime(n.id));
			assert.ok(target.renoteId == null || target.text != null, 'リノートを対象にしている');
		}
		if (n.replyId) replies++;
		if (n.renoteId) renotes++;
	}
	assert.ok(replies > data.notes.length * 0.07 && renotes > data.notes.length * 0.03);
	for (const r of data.reactions) {
		const n = byId.get(r.noteId);
		assert.ok(!(n.renoteId && n.text == null), 'リノートにリアクションしている');
		assert.notEqual(r.userId, n.userId);
	}
});

test('bulk: 添付は投稿者自身のファイルだけ', () => {
	const data = generateBulk(fakeResult(), bulkOpts);
	const owner = new Map([
		...fakeResult().photos.map((p) => [p.id, p.userId]),
		...data.driveFiles.map((f) => [f.id, f.userId]),
	]);
	let attached = 0;
	for (const n of data.notes) {
		for (const id of n.fileIds) {
			assert.equal(owner.get(id), n.userId);
			attached++;
		}
	}
	assert.ok(attached > 0);
});

test('bulk: \' を含む本文がエスケープされて SQL に入る', () => {
	const data = generateBulk(fakeResult(), bulkOpts);
	const sql = renderSql(data);
	const withQuote = data.notes.find((n) => n.text?.includes("'"));
	assert.ok(withQuote, '\' を含む本文がない');
	assert.ok(sql.includes(sqlLiteral(withQuote.text)));
	// エスケープ済みの値を取り除くと、SQL の中に裸の本文は残らない
	assert.ok(!sql.replaceAll(sqlLiteral(withQuote.text), '').includes(withQuote.text));
});

test('bulk: 同じシード値なら同じ内容', () => {
	const strip = (d) => d.notes.map((n) => [n.userId.length, n.text, n.cw, n.visibility]);
	const a = generateBulk(fakeResult(), bulkOpts);
	const b = generateBulk(fakeResult(), bulkOpts);
	assert.deepEqual(strip(a), strip(b));
	assert.deepEqual(a.reactions.map((r) => r.reaction), b.reactions.map((r) => r.reaction));
});

test('bulk: 同じシード値と seed-result なら、実行時刻が違っても本文・関係・リアクションは同じ', () => {
	// 実行ごとに変わる ID を、並び順 (添字) に置き換えて比べる。ローカルのユーザーの ID は seed-result のものなので変わらない
	const shape = (d) => {
		const noteIndex = new Map(d.notes.map((n, i) => [n.id, i]));
		const remoteIndex = new Map(d.remoteUsers.map((u, i) => [u.id, `remote${i}`]));
		const fileIndex = new Map(d.driveFiles.map((f, i) => [f.id, `link${i}`]));
		const who = (id) => remoteIndex.get(id) ?? id;
		return {
			notes: d.notes.map((n) => ({
				user: who(n.userId), text: n.text, cw: n.cw, visibility: n.visibility,
				reply: n.replyId == null ? null : noteIndex.get(n.replyId),
				renote: n.renoteId == null ? null : noteIndex.get(n.renoteId),
				files: n.fileIds.map((id) => fileIndex.get(id) ?? id),
				reactions: n.reactions, renoteCount: n.renoteCount, repliesCount: n.repliesCount,
			})),
			reactions: d.reactions.map((r) => [noteIndex.get(r.noteId), who(r.userId), r.reaction]),
			followings: d.followings.map((f) => [who(f.followerId), who(f.followeeId)]),
			hashtags: d.hashtags.map((h) => [h.name, h.mentionedUserIds.map(who)]),
		};
	};
	const result = fakeResult();
	const a = generateBulk(result, bulkOpts);
	// API の段のノートの時刻が変わったとき (= upper が 1 日の中や日をまたいで動いたとき) を、now を前にずらして再現する
	for (const hours of [7, 13.5, 30, 24 * 3 + 5]) {
		const b = generateBulk(result, { ...bulkOpts, now: NOW - hours * 60 * 60 * 1000 });
		assert.notEqual(b.range.upper, a.range.upper);
		// 大きな値の deepEqual は差分の表示に時間がかかるので、文字列にして比べ、最初に食い違う場所を示す
		const sa = shape(a);
		const sb = shape(b);
		for (const key of Object.keys(sa)) {
			const i = sa[key].findIndex((v, k) => JSON.stringify(v) !== JSON.stringify(sb[key][k]));
			assert.ok(i === -1 && sa[key].length === sb[key].length, `${hours} 時間ずらすと ${key} が変わる (${i} 番目)`);
		}
	}
});
