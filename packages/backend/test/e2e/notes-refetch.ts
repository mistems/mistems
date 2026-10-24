/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { api, castAsError, post, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

/**
 * notes/refetch エンドポイントの e2e テスト。
 *
 * AP の実フェッチは行わない (ローカルノートはガードで弾かれ、存在しないノートは即エラー)。
 * リモートノート正常系は DB 準備が必要なため unit (test/unit/ApNoteService.ts) 側でカバーする。
 *
 * NOTE: backend e2e は `.config/test.yml` + Postgres/Redis を要求する。
 */
describe('notes/refetch', () => {
	let alice: misskey.entities.SignupResponse;
	let aliceNote: misskey.entities.Note;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		aliceNote = await post(alice, { text: 'hi' });
	}, 1000 * 60 * 2);

	test('認証なしだと requireCredential により弾かれる', async () => {
		const res = await api('notes/refetch', {
			noteId: aliceNote.id,
		});

		assert.strictEqual(res.status, 401);
	});

	test('存在しない noteId だと NO_SUCH_NOTE になる', async () => {
		const res = await api('notes/refetch', {
			noteId: 'something',
		}, alice);

		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_NOTE');
	});

	test('ローカルノートを渡すと IS_LOCAL_NOTE エラーになる', async () => {
		const res = await api('notes/refetch', {
			noteId: aliceNote.id,
		}, alice);

		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'IS_LOCAL_NOTE');
	});
});
