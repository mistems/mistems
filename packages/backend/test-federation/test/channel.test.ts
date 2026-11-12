/*
 * チャンネル連合 (channel.federationPolicy) の連合テスト。
 * 確認項目の番号 (F1〜F10) は docs/planning/2026-11-12-チャンネル連合-資料4-ローカルの連合環境.md に対応する。
 * F8 (リレー) は DB の操作が要るので、ここでは扱わない。
 */

import { describe, test, beforeAll, vi } from 'vitest';
import assert, { rejects, strictEqual } from 'node:assert';
import * as Misskey from 'misskey-js';
import { createAccount, type LoginUser, resolveRemoteNote, resolveRemoteUser, sleep, waitForFollowRelation, WAIT_FOR_FEDERATION } from './utils.js';

describe('Channel federation', () => {
	let alice: LoginUser, carol: LoginUser, bob: LoginUser;
	let aliceInB: Misskey.entities.UserDetailedNotMe, bobInA: Misskey.entities.UserDetailedNotMe;

	async function createChannel(owner: LoginUser, federationPolicy: 'none' | 'home' | 'public'): Promise<Misskey.entities.Channel> {
		const name = `ch-${crypto.randomUUID().substring(0, 8)}`;
		return await owner.client.request('channels/create', { name, federationPolicy });
	}

	async function postToChannel(user: LoginUser, channelId: string, params: Partial<Misskey.entities.NotesCreateRequest> = {}): Promise<Misskey.entities.Note> {
		return (await user.client.request('notes/create', { text: crypto.randomUUID(), channelId, ...params })).createdNote;
	}

	/** bob のホームタイムラインに届くまで待ち、b.test でのノートを返す */
	async function waitForNoteInBobHome(noteId: string): Promise<Misskey.entities.Note> {
		const uri = `https://a.test/notes/${noteId}`;
		return await vi.waitFor(async () => {
			const notes = await bob.client.request('notes/timeline', { limit: 100 });
			const found = notes.find(n => n.uri === uri);
			assert(found != null);
			return found;
		}, WAIT_FOR_FEDERATION);
	}

	/**
	 * a.test の AP エンドポイントからノートを直接取りに行き、HTTP の状態コードを返す。
	 * `cacheKey` を渡すと、クエリ文字列を付けて nginx のキャッシュとは別の URL として取りに行く
	 */
	async function fetchApNoteStatus(noteId: string, cacheKey?: string): Promise<number> {
		const query = cacheKey != null ? `?${cacheKey}` : '';
		const res = await fetch(`https://a.test/notes/${noteId}${query}`, {
			headers: { Accept: 'application/activity+json' },
		});
		return res.status;
	}

	beforeAll(async () => {
		[alice, carol, bob] = await Promise.all([
			createAccount('a.test'),
			createAccount('a.test'),
			createAccount('b.test'),
		]);

		[aliceInB, bobInA] = await Promise.all([
			resolveRemoteUser('a.test', alice.id, bob),
			resolveRemoteUser('b.test', bob.id, alice),
		]);

		// bob が alice をフォローして配送を受け、alice も bob をフォローして bob の followers 限定のリプライを受け取る
		await bob.client.request('following/create', { userId: aliceInB.id });
		await alice.client.request('following/create', { userId: bobInA.id });
		await Promise.all([
			waitForFollowRelation(bob, alice, 1),
			waitForFollowRelation(alice, bob, 1),
		]);
	});

	describe('federationPolicy: home', () => {
		let channel: Misskey.entities.Channel;
		let note: Misskey.entities.Note;
		let noteInB: Misskey.entities.Note;

		beforeAll(async () => {
			channel = await createChannel(alice, 'home');
			note = await postToChannel(alice, channel.id);
			noteInB = await waitForNoteInBobHome(note.id);
		});

		test('F1: 相手には home の可視性で届き、チャンネルには属さない', async () => {
			strictEqual(note.visibility, 'home');
			strictEqual(note.localOnly, false);
			strictEqual(noteInB.visibility, 'home');
			strictEqual(noteInB.channelId ?? null, null);

			const [ltl, gtl] = await Promise.all([
				bob.client.request('notes/local-timeline', { limit: 100 }),
				bob.client.request('notes/global-timeline', { limit: 100 }),
			]);
			strictEqual(ltl.some(n => n.uri === noteInB.uri), false);
			strictEqual(gtl.some(n => n.uri === noteInB.uri), false);
		});

		test('F3: 相手から見た本文の末尾に、チャンネル名と URL が付く', async () => {
			assert(noteInB.text != null);
			assert(
				noteInB.text.endsWith(`From: 「${channel.name}」 https://a.test/channels/${channel.id}`),
				`unexpected text: ${noteInB.text}`,
			);
			// 元のノートの本文は書き換えない
			strictEqual(note.text?.includes('From:'), false);
		});

		test('F4: 相手からのリプライが、同じチャンネルに入る', async () => {
			const reply = (await bob.client.request('notes/create', { text: crypto.randomUUID(), replyId: noteInB.id })).createdNote;
			const replyUri = `https://b.test/notes/${reply.id}`;

			const replyInA = await vi.waitFor(async () => {
				const notes = await alice.client.request('channels/timeline', { channelId: channel.id, limit: 100 });
				const found = notes.find(n => n.uri === replyUri);
				assert(found != null);
				return found;
			}, WAIT_FOR_FEDERATION);
			strictEqual(replyInA.channelId, channel.id);
			strictEqual(replyInA.localOnly ?? false, false);
		});

		test('F5: 相手の followers 限定・ダイレクトのリプライは、チャンネルに入らない', async () => {
			const followersReply = (await bob.client.request('notes/create', {
				text: crypto.randomUUID(), replyId: noteInB.id, visibility: 'followers',
			})).createdNote;
			const specifiedReply = (await bob.client.request('notes/create', {
				text: crypto.randomUUID(), replyId: noteInB.id, visibility: 'specified', visibleUserIds: [aliceInB.id],
			})).createdNote;
			const uris = [followersReply, specifiedReply].map(n => `https://b.test/notes/${n.id}`);

			const repliesInA = await vi.waitFor(async () => {
				const replies = await alice.client.request('notes/replies', { noteId: note.id, limit: 100 });
				const found = uris.map(uri => replies.find(n => n.uri === uri));
				assert(found.every(n => n != null));
				return found as Misskey.entities.Note[];
			}, WAIT_FOR_FEDERATION);
			for (const reply of repliesInA) {
				strictEqual(reply.channelId ?? null, null);
			}

			const channelNotes = await alice.client.request('channels/timeline', { channelId: channel.id, limit: 100 });
			for (const uri of uris) {
				strictEqual(channelNotes.some(n => n.uri === uri), false);
			}
		});

		test('F6: 相手からのリアクションが届き、相手のリノートは home 止まりになる', async () => {
			await bob.client.request('notes/reactions/create', { noteId: noteInB.id, reaction: '👍' });
			await vi.waitFor(async () => {
				const noteInA = await alice.client.request('notes/show', { noteId: note.id });
				strictEqual(noteInA.reactions['👍'], 1);
			}, WAIT_FOR_FEDERATION);

			const renote = (await bob.client.request('notes/create', { renoteId: noteInB.id })).createdNote;
			strictEqual(renote.visibility, 'home');
		});
	});

	describe('federationPolicy: public', () => {
		let channel: Misskey.entities.Channel;

		beforeAll(async () => {
			channel = await createChannel(alice, 'public');
		});

		test('F2・F3: 相手には public で届き、相手の GTL に載る', async () => {
			const note = await postToChannel(alice, channel.id);
			strictEqual(note.visibility, 'public');
			strictEqual(note.localOnly, false);

			const noteInB = await waitForNoteInBobHome(note.id);
			strictEqual(noteInB.visibility, 'public');
			assert(noteInB.text?.endsWith(`https://a.test/channels/${channel.id}`));

			await vi.waitFor(async () => {
				const gtl = await bob.client.request('notes/global-timeline', { limit: 100 });
				assert(gtl.some(n => n.uri === noteInB.uri));
			}, WAIT_FOR_FEDERATION);
		});

		test('F10: 削除が相手に届く', async () => {
			const note = await postToChannel(alice, channel.id);
			const noteInB = await waitForNoteInBobHome(note.id);

			await alice.client.request('notes/delete', { noteId: note.id });
			await vi.waitFor(async () => {
				await rejects(
					async () => await bob.client.request('notes/show', { noteId: noteInB.id }),
					(err: any) => err.code === 'NO_SUCH_NOTE',
				);
			}, WAIT_FOR_FEDERATION);
		});

		test('F10: 投票の更新が相手に届く', async () => {
			const note = await postToChannel(alice, channel.id, { poll: { choices: ['inu', 'neko'] } });
			const noteInB = await waitForNoteInBobHome(note.id);

			await carol.client.request('notes/polls/vote', { noteId: note.id, choice: 1 });
			await vi.waitFor(async () => {
				const updated = await bob.client.request('notes/show', { noteId: noteInB.id });
				assert(updated.poll != null);
				strictEqual(updated.poll.choices[0].votes, 0);
				strictEqual(updated.poll.choices[1].votes, 1);
			}, WAIT_FOR_FEDERATION);
		});
	});

	describe('federationPolicy: none', () => {
		test('F7: 配送されず、AP で取りに来られても返さない', async () => {
			const channel = await createChannel(alice, 'none');
			const note = await postToChannel(alice, channel.id);
			strictEqual(note.localOnly, true);

			strictEqual(await fetchApNoteStatus(note.id), 404);
			await rejects(async () => await resolveRemoteNote('a.test', note.id, bob));

			// 届かないことの確認なので、ほかの配送が届く程度に待ってから 1 回だけ見る
			await sleep(2000);
			const notes = await bob.client.request('notes/timeline', { limit: 100 });
			strictEqual(notes.some(n => n.uri === `https://a.test/notes/${note.id}`), false);
		});

		test('F9: 連合を none に戻すと過去のノートを返さなくなり、戻したあとのリプライはチャンネルに入る', async () => {
			const channel = await createChannel(alice, 'home');
			const delivered = await postToChannel(alice, channel.id);
			// carol はだれにもフォローされていないので、このノートは b.test にまだ知られていない
			const undelivered = await postToChannel(carol, channel.id);
			const deliveredInB = await waitForNoteInBobHome(delivered.id);
			// ノートの AP 応答は `Cache-Control: public, max-age=180` で、a.test の前の nginx が保存する。
			// 切り替える前に同じ URL で取ると、切り替えたあとも最長 180 秒は 200 が返るので、
			// 切り替え前の確認は別の URL (クエリ付き) で行う
			strictEqual(await fetchApNoteStatus(undelivered.id, 'before-switch'), 200);

			await alice.client.request('channels/update', { channelId: channel.id, federationPolicy: 'none' });

			strictEqual(await fetchApNoteStatus(delivered.id), 404);
			strictEqual(await fetchApNoteStatus(undelivered.id), 404);
			await rejects(async () => await resolveRemoteNote('a.test', undelivered.id, bob));

			const reply = (await bob.client.request('notes/create', { text: crypto.randomUUID(), replyId: deliveredInB.id })).createdNote;
			const replyUri = `https://b.test/notes/${reply.id}`;
			await vi.waitFor(async () => {
				const notes = await alice.client.request('channels/timeline', { channelId: channel.id, limit: 100 });
				assert(notes.some(n => n.uri === replyUri));
			}, WAIT_FOR_FEDERATION);
		});
	});
});
