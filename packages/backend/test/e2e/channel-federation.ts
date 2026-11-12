/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { beforeAll, describe, test } from 'vitest';
import { api, castAsError, post, signup, simpleGet } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('チャンネル連合 (federationPolicy)', () => {
	let alice: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		// AP エンドポイントのテスト用に連合を有効にする (最初に作ったユーザーは管理者)
		await api('admin/update-meta', { federation: 'all' }, alice);
	}, 1000 * 60 * 2);

	describe('channels/create', () => {
		test('既定は連合しない (none)', async () => {
			const res = await api('channels/create', { name: 'default-channel' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationPolicy, 'none');
		});

		test('federationPolicy を指定して作成できる', async () => {
			const res = await api('channels/create', { name: 'federated-channel', federationPolicy: 'home' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationPolicy, 'home');
		});

		test('チャンネル外リノート禁止と連合は同時に指定できない', async () => {
			const res = await api('channels/create', { name: 'bad-channel', federationPolicy: 'home', allowRenoteToExternal: false }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION');
		});
	});

	describe('channels/update', () => {
		test('チャンネル外リノート禁止のチャンネルを連合に変更できない', async () => {
			const channel = (await api('channels/create', { name: 'no-external-renote', allowRenoteToExternal: false }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, federationPolicy: 'home' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION');
		});

		test('連合中のチャンネルをリノート禁止に変更できない', async () => {
			const channel = (await api('channels/create', { name: 'federated-then-restrict', federationPolicy: 'public' }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, allowRenoteToExternal: false }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION');
		});

		test('federationPolicy を変更できる', async () => {
			const channel = (await api('channels/create', { name: 'to-be-federated' }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, federationPolicy: 'public' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationPolicy, 'public');
		});
	});

	describe('チャンネルノートの可視性と localOnly', () => {
		test('none: 従来どおり public + localOnly', async () => {
			const channel = (await api('channels/create', { name: 'none-notes' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual(note.visibility, 'public');
			assert.strictEqual(note.localOnly, true);
		});

		test('home: home + 連合する', async () => {
			const channel = (await api('channels/create', { name: 'home-notes', federationPolicy: 'home' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual(note.visibility, 'home');
			assert.strictEqual(note.localOnly, false);
		});

		test('public: public + 連合する', async () => {
			const channel = (await api('channels/create', { name: 'public-notes', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual(note.visibility, 'public');
			assert.strictEqual(note.localOnly, false);
		});

		test('連合チャンネルでもノート単位の localOnly は尊重される', async () => {
			const channel = (await api('channels/create', { name: 'home-localonly', federationPolicy: 'home' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id, localOnly: true });
			assert.strictEqual(note.visibility, 'public');
			assert.strictEqual(note.localOnly, true);
		});

		test('連合チャンネルで localOnly ノートにリプライしても home + localOnly にならない (public + localOnly に落ちる)', async () => {
			const channel = (await api('channels/create', { name: 'home-reply-lo', federationPolicy: 'home' }, alice)).body;
			const parent = await post(alice, { text: 'parent', channelId: channel.id, localOnly: true });
			const reply = (await api('notes/create', { text: 'reply', channelId: channel.id, replyId: parent.id }, alice)).body.createdNote;
			assert.strictEqual(reply.visibility, 'public');
			assert.strictEqual(reply.localOnly, true);
		});

		test('チャンネルノートに followers/specified の公開範囲は指定できない (400)', async () => {
			const channel = (await api('channels/create', { name: 'reject-visibility', federationPolicy: 'public' }, alice)).body;
			const specified = await api('notes/create', { text: 'a', channelId: channel.id, visibility: 'specified' }, alice);
			assert.strictEqual(specified.status, 400);
			assert.strictEqual(castAsError(specified.body as any).error.code, 'CANNOT_SPECIFY_VISIBILITY_FOR_CHANNEL_NOTE');
			const followers = await api('notes/create', { text: 'a', channelId: channel.id, visibility: 'followers' }, alice);
			assert.strictEqual(followers.status, 400);
		});

		test('アーカイブ済みチャンネルへのリプライはスコープ整合を優先しチャンネルに入る (公開ノートに漏れない)', async () => {
			const channel = (await api('channels/create', { name: 'archived-reply', federationPolicy: 'public' }, alice)).body;
			const parent = await post(alice, { text: 'parent', channelId: channel.id });
			await api('channels/update', { channelId: channel.id, isArchived: true }, alice);
			// channelId を送らずリプライしても、チャンネル外の通常公開ノートには化けずチャンネルに留まる
			const reply = (await api('notes/create', { text: 'reply', replyId: parent.id }, alice)).body.createdNote;
			assert.strictEqual(reply.channelId, channel.id);
		});

		test('連合チャンネルで自分の followers ノートを引用しても連合されない (localOnly に落ちる)', async () => {
			const channel = (await api('channels/create', { name: 'quote-followers', federationPolicy: 'public' }, alice)).body;
			const followersNote = await post(alice, { text: 'secret', visibility: 'followers' });
			// 引用 (renoteId + text) はチャンネルに入るが、followers 由来なので widening されず localOnly 止まり
			// (public + localOnly = 従来のチャンネルノートと同形。連合はされない)
			const quote = (await api('notes/create', { text: 'quote', channelId: channel.id, renoteId: followersNote.id }, alice)).body.createdNote;
			assert.strictEqual(quote.localOnly, true);
			assert.strictEqual(quote.visibility, 'public');
		});
	});

	describe('公開ノート一覧 (/api/notes) への露出', () => {
		test('連合チャンネル (public) のノートは公開ノート一覧に出ない', async () => {
			const channel = (await api('channels/create', { name: 'not-in-notes-list', federationPolicy: 'public' }, alice)).body;
			const channelNote = await post(alice, { text: 'channel note', channelId: channel.id });
			const normalNote = await post(alice, { text: 'normal note' });

			const res = await api('notes', {});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.some((note: any) => note.id === normalNote.id), true);
			assert.strictEqual(res.body.some((note: any) => note.id === channelNote.id), false);
		});
	});

	describe('AP エンドポイント (/notes/:id)', () => {
		const AP = 'application/activity+json';

		test('連合しないチャンネルのノートは返さない', async () => {
			const channel = (await api('channels/create', { name: 'ap-none' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			const res = await simpleGet(`/notes/${note.id}`, AP);
			assert.strictEqual(res.status, 404);
		});

		test('連合するチャンネルのノートは本文にチャンネルの URL を付けて返す', async () => {
			const channel = (await api('channels/create', { name: 'ap-public', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'hello', channelId: channel.id });
			const res = await simpleGet(`/notes/${note.id}`, AP);
			assert.strictEqual(res.status, 200);
			assert.ok((res.body as any).content.includes(`/channels/${channel.id}`));
		});

		test('連合を none に戻したチャンネルのノートは以後返さない', async () => {
			const channel = (await api('channels/create', { name: 'ap-disabled', federationPolicy: 'home' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual((await simpleGet(`/notes/${note.id}`, AP)).status, 200);
			await api('channels/update', { channelId: channel.id, federationPolicy: 'none' }, alice);
			assert.strictEqual((await simpleGet(`/notes/${note.id}`, AP)).status, 404);
		});
	});
});
