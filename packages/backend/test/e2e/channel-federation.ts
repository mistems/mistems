/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { api, castAsError, initTestDb, post, signup, simpleGet } from '../utils.js';
import type * as misskey from 'misskey-js';
import { MiNote, MiUser } from '@/models/_.js';

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
			const res = await api('channels/create', { name: 'federated-channel', federationPolicy: 'public' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationPolicy, 'public');
		});

		test('federationPolicy に home は指定できない (なくした値)', async () => {
			const res = await api('channels/create', { name: 'home-channel', federationPolicy: 'home' } as any, alice);
			assert.strictEqual(res.status, 400);
		});

		test('チャンネル外リノート禁止と連合は同時に指定できない', async () => {
			const res = await api('channels/create', { name: 'bad-channel', federationPolicy: 'public', allowRenoteToExternal: false }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION');
		});
	});

	describe('channels/update', () => {
		test('チャンネル外リノート禁止のチャンネルを連合に変更できない', async () => {
			const channel = (await api('channels/create', { name: 'no-external-renote', allowRenoteToExternal: false }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, federationPolicy: 'public' }, alice);
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

		test('public: public + 連合する', async () => {
			const channel = (await api('channels/create', { name: 'public-notes', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual(note.visibility, 'public');
			assert.strictEqual(note.localOnly, false);
		});

		test('連合チャンネルでもノート単位の localOnly は尊重される', async () => {
			const channel = (await api('channels/create', { name: 'public-localonly', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id, localOnly: true });
			assert.strictEqual(note.visibility, 'public');
			assert.strictEqual(note.localOnly, true);
		});

		test('連合チャンネルで localOnly ノートにリプライすると public + localOnly に落ちる', async () => {
			const channel = (await api('channels/create', { name: 'public-reply-lo', federationPolicy: 'public' }, alice)).body;
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

		test('連合するチャンネルのノートは本文にチャンネルのハッシュタグを付けて返す', async () => {
			const channel = (await api('channels/create', { name: 'ap-public', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'hello', channelId: channel.id });
			const res = await simpleGet(`/notes/${note.id}`, AP);
			assert.strictEqual(res.status, 200);
			assert.ok((res.body as any).content.includes(channel.federationHashtag!), (res.body as any).content);
		});

		test('連合を none に戻したチャンネルのノートは以後返さない', async () => {
			const channel = (await api('channels/create', { name: 'ap-disabled', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'a', channelId: channel.id });
			assert.strictEqual((await simpleGet(`/notes/${note.id}`, AP)).status, 200);
			await api('channels/update', { channelId: channel.id, federationPolicy: 'none' }, alice);
			assert.strictEqual((await simpleGet(`/notes/${note.id}`, AP)).status, 404);
		});
	});

	describe('チャンネルのハッシュタグ (federationHashtag)', () => {
		const MARKER = '連合チャンネル_';

		test('連合しないチャンネルにはハッシュタグを付けない', async () => {
			const res = await api('channels/create', { name: 'hashtag-none' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationHashtag, null);
		});

		test('連合するチャンネルを作ると、ハッシュタグを付ける (使えない文字は取り除く)', async () => {
			const res = await api('channels/create', { name: 'タグ・作成 a.b', federationPolicy: 'public' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationHashtag, `${MARKER}タグ作成ab`);
			assert.match(res.body.federationHashtag!, /^[\p{L}\p{N}_]+$/u);
		});

		test('連合に変えるとハッシュタグを付け、none に戻しても消さず、名前を変えても変わらない', async () => {
			const channel = (await api('channels/create', { name: 'hashtag-later' }, alice)).body;
			const enabled = await api('channels/update', { channelId: channel.id, federationPolicy: 'public' }, alice);
			assert.strictEqual(enabled.status, 200);
			const hashtag = enabled.body.federationHashtag;
			assert.ok(hashtag?.endsWith(`${MARKER}hashtaglater`), hashtag ?? 'null');

			const renamed = await api('channels/update', { channelId: channel.id, name: 'renamed' }, alice);
			assert.strictEqual(renamed.body.federationHashtag, hashtag);

			const disabled = await api('channels/update', { channelId: channel.id, federationPolicy: 'none' }, alice);
			assert.strictEqual(disabled.body.federationHashtag, hashtag);
		});

		test('同じ名前の連合するチャンネルには _2 を付ける', async () => {
			const first = (await api('channels/create', { name: 'dup-name', federationPolicy: 'public' }, alice)).body;
			const second = (await api('channels/create', { name: 'dup-name', federationPolicy: 'public' }, alice)).body;
			assert.strictEqual(second.federationHashtag, `${first.federationHashtag}_2`);
		});

		test('持ち主はハッシュタグを変えられる (先頭の # は取り除く)', async () => {
			const channel = (await api('channels/create', { name: 'hashtag-change', federationPolicy: 'public' }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, federationHashtag: `#独自${MARKER}変更後` }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.federationHashtag, `独自${MARKER}変更後`);
		});

		test('ハッシュタグの変更の誤りは、エラーコードを分けて返す', async () => {
			const channel = (await api('channels/create', { name: 'hashtag-errors', federationPolicy: 'public' }, alice)).body;
			const other = (await api('channels/create', { name: 'hashtag-taken', federationPolicy: 'public' }, alice)).body;

			const invalid = await api('channels/update', { channelId: channel.id, federationHashtag: `a.b${MARKER}c` }, alice);
			assert.strictEqual(invalid.status, 400);
			assert.strictEqual(castAsError(invalid.body as any).error.code, 'INVALID_FEDERATION_HASHTAG');

			const tooLong = await api('channels/update', { channelId: channel.id, federationHashtag: `${MARKER}${'a'.repeat(128)}` }, alice);
			assert.strictEqual(tooLong.status, 400);
			assert.strictEqual(castAsError(tooLong.body as any).error.code, 'FEDERATION_HASHTAG_TOO_LONG');

			const noMarker = await api('channels/update', { channelId: channel.id, federationHashtag: 'cats' }, alice);
			assert.strictEqual(noMarker.status, 400);
			assert.strictEqual(castAsError(noMarker.body as any).error.code, 'FEDERATION_HASHTAG_MUST_CONTAIN_MARKER');

			// 大文字・小文字の違いだけでも重なりとみなす
			const taken = await api('channels/update', { channelId: channel.id, federationHashtag: other.federationHashtag!.toUpperCase() }, alice);
			assert.strictEqual(taken.status, 400);
			assert.strictEqual(castAsError(taken.body as any).error.code, 'FEDERATION_HASHTAG_ALREADY_USED');
		});

		test('ほかの人はハッシュタグを変えられない', async () => {
			const bob = await signup({ username: 'hashtag_bob' });
			const channel = (await api('channels/create', { name: 'hashtag-owner', federationPolicy: 'public' }, alice)).body;
			const res = await api('channels/update', { channelId: channel.id, federationHashtag: `bob${MARKER}x` }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'ACCESS_DENIED');
		});

		test('連合するチャンネルへの投稿は、ローカルの tags と AP の tag にハッシュタグが入り、付記はハッシュタグだけになる', async () => {
			const channel = (await api('channels/create', { name: 'hashtag-ap', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'hello', channelId: channel.id });
			assert.deepStrictEqual(note.tags, [channel.federationHashtag!.toLowerCase()]);

			const res = await simpleGet(`/notes/${note.id}`, 'application/activity+json');
			assert.strictEqual(res.status, 200);
			const body = res.body as any;
			assert.strictEqual(body._misskey_content, `hello\n\n#${channel.federationHashtag}`);
			assert.ok(!body.content.includes(`/channels/${channel.id}`), body.content);
			assert.ok(!body.content.includes('From: '), body.content);
			const tags = (body.tag ?? []) as { type: string; name?: string }[];
			assert.deepStrictEqual(tags.filter(t => t.type === 'Hashtag').map(t => t.name?.toLowerCase()), [`#${channel.federationHashtag!.toLowerCase()}`]);

			// 自分のサーバーのハッシュタグのページにも出る
			const searched = await api('notes/search-by-tag', { tag: channel.federationHashtag! }, alice);
			assert.strictEqual(searched.status, 200);
			assert.ok((searched.body as { id: string }[]).some(n => n.id === note.id));
		});

		test('連合しないチャンネルとローカル限定の投稿には、ハッシュタグを付けない', async () => {
			const channel = (await api('channels/create', { name: 'hashtag-none', federationPolicy: 'public' }, alice)).body;
			const localOnly = await post(alice, { text: 'local', channelId: channel.id, localOnly: true });
			assert.deepStrictEqual(localOnly.tags ?? [], []);

			const closed = (await api('channels/create', { name: 'hashtag-closed', federationPolicy: 'none' }, alice)).body;
			const note = await post(alice, { text: 'closed', channelId: closed.id });
			assert.deepStrictEqual(note.tags ?? [], []);
		});

		test('「連合チャンネル_」を含むハッシュタグはトレンドに数えない', async () => {
			const users = await Promise.all([1, 2, 3].map(i => signup({ username: `trend_user${i}` })));
			const plainTag = 'chhtrendplain';
			const channelTag = `trend${MARKER}x`;
			for (const user of users) {
				await post(user, { text: `#${plainTag} #${channelTag}` });
			}
			// トレンドの集計 (Redis) は投稿のあとに非同期で行われるので、少し待つ
			await new Promise(resolve => setTimeout(resolve, 1000));

			const res = await api('hashtags/trend', {}, alice);
			assert.strictEqual(res.status, 200);
			const trendTags = (res.body as { tag: string }[]).map(x => x.tag);
			assert.ok(trendTags.includes(plainTag), JSON.stringify(trendTags));
			assert.ok(!trendTags.some(tag => tag.includes(MARKER)), JSON.stringify(trendTags));
		});
	});

	describe('channels/remove-note', () => {
		// e2e には相手のサーバーがないので、ローカルのユーザーとノートを DB の上でリモートのものに書き換え、
		// ハッシュタグで収蔵したリモートのノートの代わりにする
		const createCollectedRemoteNote = async (channelId: string) => {
			const carol = await signup({ username: `remote_${Date.now()}` });
			const note = await post(carol, { text: 'from remote' });
			const db = await initTestDb(true);
			try {
				await db.getRepository(MiUser).update({ id: carol.id }, { host: 'remote.example' });
				await db.getRepository(MiNote).update({ id: note.id }, { userHost: 'remote.example', channelId });
			} finally {
				await db.destroy();
			}
			return note;
		};

		test('持ち主は収蔵したリモートのノートをチャンネルから外せる (ノートは消さない)', async () => {
			const channel = (await api('channels/create', { name: 'remove-owner', federationPolicy: 'public' }, alice)).body;
			const note = await createCollectedRemoteNote(channel.id);

			const before = await api('channels/timeline', { channelId: channel.id }, alice);
			assert.ok(before.body.some(n => n.id === note.id));

			const res = await api('channels/remove-note', { noteId: note.id }, alice);
			assert.strictEqual(res.status, 204);

			const after = await api('channels/timeline', { channelId: channel.id }, alice);
			assert.ok(!after.body.some(n => n.id === note.id));

			const shown = await api('notes/show', { noteId: note.id }, alice);
			assert.strictEqual(shown.status, 200);
			assert.strictEqual(shown.body.channelId ?? null, null);
		});

		test('モデレーターは外せる', async () => {
			const owner = await signup({ username: 'remove_owner2' });
			const channel = (await api('channels/create', { name: 'remove-mod', federationPolicy: 'public' }, owner)).body;
			const note = await createCollectedRemoteNote(channel.id);
			// alice は最初に作ったユーザーなので管理者
			const res = await api('channels/remove-note', { noteId: note.id }, alice);
			assert.strictEqual(res.status, 204);
		});

		test('持ち主とモデレーター以外は外せない', async () => {
			const bob = await signup({ username: 'remove_bob' });
			const channel = (await api('channels/create', { name: 'remove-denied', federationPolicy: 'public' }, alice)).body;
			const note = await createCollectedRemoteNote(channel.id);
			const res = await api('channels/remove-note', { noteId: note.id }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'ACCESS_DENIED');
		});

		test('ローカルのノートは外せない', async () => {
			const channel = (await api('channels/create', { name: 'remove-local', federationPolicy: 'public' }, alice)).body;
			const note = await post(alice, { text: 'local', channelId: channel.id });
			const res = await api('channels/remove-note', { noteId: note.id }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'CANNOT_REMOVE_LOCAL_NOTE');
		});

		test('ないノートは外せない', async () => {
			const res = await api('channels/remove-note', { noteId: 'aaaaaaaaaa' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_NOTE');
		});

		test('チャンネルに入っていないノートは外せない', async () => {
			const note = await post(alice, { text: 'not in channel' });
			const res = await api('channels/remove-note', { noteId: note.id }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NOT_IN_CHANNEL');
		});
	});

	describe.each([
		{ enableFanoutTimeline: true },
		{ enableFanoutTimeline: false },
	])('チャンネルに収蔵されたリモートのノートをフォロワーのホームに出す (enableFanoutTimeline: $enableFanoutTimeline)', ({ enableFanoutTimeline }) => {
		beforeAll(async () => {
			await api('admin/update-meta', { enableFanoutTimeline }, alice);
		});

		afterAll(async () => {
			await api('admin/update-meta', { enableFanoutTimeline: true }, alice);
		});

		// e2e には相手のサーバーがないので、フォローしてから投稿させ、DB の上でリモートのユーザーとチャンネルのノートに書き換える。
		// enableFanoutTimeline のときは、ローカルのノートとして配られた homeTimeline の分がそのまま残るので、
		// 収蔵したノートを投稿者のフォロワーにも配った (pushToTl) のと同じ状態になる
		const setup = async (suffix: string) => {
			const follower = await signup({ username: `col_f_${suffix}_${enableFanoutTimeline ? 'r' : 'd'}` });
			const author = await signup({ username: `col_a_${suffix}_${enableFanoutTimeline ? 'r' : 'd'}` });
			const channel = (await api('channels/create', { name: `collected-${suffix}`, federationPolicy: 'public' }, alice)).body;
			await api('following/create', { userId: author.id }, follower);
			const note = await post(author, { text: 'collected note' });
			const db = await initTestDb(true);
			try {
				await db.getRepository(MiUser).update({ id: author.id }, { host: 'remote.example' });
				await db.getRepository(MiNote).update({ id: note.id }, { userHost: 'remote.example', channelId: channel.id });
			} finally {
				await db.destroy();
			}
			return { follower, author, channel, note };
		};

		test('notes/timeline: 既定では出て、withCollectedChannelNotes: false では出ない', async () => {
			const { follower, note } = await setup('home');

			const res = await api('notes/timeline', { limit: 100 }, follower);
			assert.strictEqual(res.status, 200);
			assert.ok(res.body.some(n => n.id === note.id));

			const res2 = await api('notes/timeline', { limit: 100, withCollectedChannelNotes: false }, follower);
			assert.strictEqual(res2.status, 200);
			assert.ok(!res2.body.some(n => n.id === note.id));
		});

		test('notes/hybrid-timeline: 既定では出て、withCollectedChannelNotes: false では出ない', async () => {
			const { follower, note } = await setup('hybrid');

			const res = await api('notes/hybrid-timeline', { limit: 100 }, follower);
			assert.strictEqual(res.status, 200);
			assert.ok(res.body.some(n => n.id === note.id));

			const res2 = await api('notes/hybrid-timeline', { limit: 100, withCollectedChannelNotes: false }, follower);
			assert.strictEqual(res2.status, 200);
			assert.ok(!res2.body.some(n => n.id === note.id));
		});

		test('チャンネルをフォローしていれば、withCollectedChannelNotes: false でも出る', async () => {
			const { follower, channel, note } = await setup('chfollow');
			await api('channels/follow', { channelId: channel.id }, follower);

			const res = await api('notes/timeline', { limit: 100, withCollectedChannelNotes: false }, follower);
			assert.strictEqual(res.status, 200);
			assert.ok(res.body.some(n => n.id === note.id));
		});

		test('チャンネルをミュートしていれば出ない', async () => {
			const { follower, channel, note } = await setup('chmute');
			await api('channels/mute/create', { channelId: channel.id }, follower);

			const res = await api('notes/timeline', { limit: 100 }, follower);
			assert.strictEqual(res.status, 200);
			assert.ok(!res.body.some(n => n.id === note.id));

			const res2 = await api('notes/hybrid-timeline', { limit: 100 }, follower);
			assert.strictEqual(res2.status, 200);
			assert.ok(!res2.body.some(n => n.id === note.id));
		});

		test('投稿者をフォローしていない人のホームには出ない', async () => {
			const { note } = await setup('nofollow');
			const stranger = await signup({ username: `col_s_${enableFanoutTimeline ? 'r' : 'd'}` });

			const res = await api('notes/timeline', { limit: 100 }, stranger);
			assert.strictEqual(res.status, 200);
			assert.ok(!res.body.some(n => n.id === note.id));
		});
	});
});
