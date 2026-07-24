/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('FF search (users/following, users/followers の query パラメータ)', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });

		await api('i/update', { name: 'Bob The Tester' }, bob);

		await api('following/create', { userId: bob.id }, alice);
		await api('following/create', { userId: carol.id }, alice);
		await api('following/create', { userId: alice.id }, bob);
	}, 1000 * 60 * 2);

	test('query 未指定ならフォロー全員が返る', async () => {
		const res = await api('users/following', {
			userId: alice.id,
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 2);
	});

	test('query で表示名を部分一致検索できる', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: 'The Tester',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 1);
		assert.strictEqual(res.body[0].followee?.id, bob.id);
	});

	test('query の @ 始まりでユーザー名を前方一致検索できる', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: '@car',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 1);
		assert.strictEqual(res.body[0].followee?.id, carol.id);
	});

	test('query でユーザー名を部分一致検索できる', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: 'aro',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 1);
		assert.strictEqual(res.body[0].followee?.id, carol.id);
	});

	test('query に一致しない場合は空配列', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: 'zzzzzzzz',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 0);
	});

	test('query の SQL ワイルドカード文字はエスケープされる', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: '%',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 0);
	});

	test('query が空文字なら全員が返る', async () => {
		const res = await api('users/following', {
			userId: alice.id,
			query: '',
		}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.length, 2);
	});

	test('users/followers も query で検索できる', async () => {
		const resHit = await api('users/followers', {
			userId: bob.id,
			query: '@alice',
		}, bob);

		assert.strictEqual(resHit.status, 200);
		assert.strictEqual(resHit.body.length, 1);
		assert.strictEqual(resHit.body[0].follower?.id, alice.id);

		const resMiss = await api('users/followers', {
			userId: bob.id,
			query: 'zzzzzzzz',
		}, bob);

		assert.strictEqual(resMiss.status, 200);
		assert.strictEqual(resMiss.body.length, 0);
	});
});
