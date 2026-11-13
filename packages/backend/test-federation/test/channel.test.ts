/*
 * チャンネル連合 (channel.federationPolicy) の連合テスト。
 * 確認項目の番号 (F1〜F10) は docs/planning/2026-11-12-チャンネル連合-資料4-ローカルの連合環境.md に対応する。
 * F8 (リレー) は DB の操作が要るので、ここでは扱わない。
 * H1〜H6 はチャンネルのハッシュタグ (docs/planning/2026-11-13-チャンネル連合-ハッシュタグ.md §7) を確かめる。
 */

import { describe, test, beforeAll, vi } from 'vitest';
import assert, { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import * as Misskey from 'misskey-js';
import { createAccount, fetchAdmin, type LoginUser, resolveRemoteNote, resolveRemoteUser, sleep, waitForFollowRelation, WAIT_FOR_FEDERATION } from './utils.js';

describe('Channel federation', () => {
	let alice: LoginUser, carol: LoginUser, bob: LoginUser;
	let aliceInB: Misskey.entities.UserDetailedNotMe, bobInA: Misskey.entities.UserDetailedNotMe;

	async function createChannel(owner: LoginUser, federationPolicy: 'none' | 'public'): Promise<Misskey.entities.Channel> {
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

	describe('federationPolicy: public', () => {
		let channel: Misskey.entities.Channel;
		let note: Misskey.entities.Note;
		let noteInB: Misskey.entities.Note;

		beforeAll(async () => {
			channel = await createChannel(alice, 'public');
			note = await postToChannel(alice, channel.id);
			noteInB = await waitForNoteInBobHome(note.id);
		});

		test('F2: 相手には public の可視性で届き、チャンネルには属さず、相手の GTL に載る', async () => {
			strictEqual(note.visibility, 'public');
			strictEqual(note.localOnly, false);
			strictEqual(noteInB.visibility, 'public');
			strictEqual(noteInB.channelId ?? null, null);

			await vi.waitFor(async () => {
				const gtl = await bob.client.request('notes/global-timeline', { limit: 100 });
				assert(gtl.some(n => n.uri === noteInB.uri));
			}, WAIT_FOR_FEDERATION);
		});

		test('F3: 相手から見た本文の末尾には、チャンネルのハッシュタグだけが付く (From と URL は付かない)', async () => {
			assert(noteInB.text != null);
			assert(noteInB.text.endsWith(`\n\n#${channel.federationHashtag}`), `unexpected text: ${noteInB.text}`);
			strictEqual(noteInB.text.includes('From:'), false);
			strictEqual(noteInB.text.includes(`https://a.test/channels/${channel.id}`), false);
			// 元のノートの本文は書き換えない
			strictEqual(note.text?.includes(`#${channel.federationHashtag}`), false);
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

		test('F6: 相手からのリアクションが届く', async () => {
			await bob.client.request('notes/reactions/create', { noteId: noteInB.id, reaction: '👍' });
			await vi.waitFor(async () => {
				const noteInA = await alice.client.request('notes/show', { noteId: note.id });
				strictEqual(noteInA.reactions['👍'], 1);
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
			const channel = await createChannel(alice, 'public');
			const delivered = await postToChannel(alice, channel.id);
			// carol はだれにもフォローされていないので、リレーが無ければ、このノートは b.test にまだ知られていない
			// a.test にリレーが登録されていると (fed.sh relay を実行したあとなど)、public のノートはリレー経由で
			// b.test に届くので、carol のノートも「b.test にまだ知られていない」とは言えなくなる。そのときは
			// b.test から引けないことの確認だけを外す (AP の応答が 404 になることは確かめる)
			const relays = await (await fetchAdmin('a.test')).client.request('admin/relays/list', {});
			const hasAcceptedRelay = relays.some(relay => relay.status === 'accepted');
			const undelivered = await postToChannel(carol, channel.id);
			const deliveredInB = await waitForNoteInBobHome(delivered.id);
			// ノートの AP 応答は `Cache-Control: public, max-age=180` で、a.test の前の nginx が保存する。
			// 切り替える前に同じ URL で取ると、切り替えたあとも最長 180 秒は 200 が返るので、
			// 切り替え前の確認は別の URL (クエリ付き) で行う
			strictEqual(await fetchApNoteStatus(undelivered.id, 'before-switch'), 200);

			await alice.client.request('channels/update', { channelId: channel.id, federationPolicy: 'none' });

			strictEqual(await fetchApNoteStatus(delivered.id), 404);
			strictEqual(await fetchApNoteStatus(undelivered.id), 404);
			if (!hasAcceptedRelay) {
				await rejects(async () => await resolveRemoteNote('a.test', undelivered.id, bob));
			}

			const reply = (await bob.client.request('notes/create', { text: crypto.randomUUID(), replyId: deliveredInB.id })).createdNote;
			const replyUri = `https://b.test/notes/${reply.id}`;
			await vi.waitFor(async () => {
				const notes = await alice.client.request('channels/timeline', { channelId: channel.id, limit: 100 });
				assert(notes.some(n => n.uri === replyUri));
			}, WAIT_FOR_FEDERATION);
		});
	});

	describe('チャンネルのハッシュタグ', () => {
		let channel: Misskey.entities.Channel;
		let hashtag: string;

		/** alice のホームタイムラインに bob のノートが届くまで待ち、a.test でのノートを返す */
		async function waitForBobNoteInAliceHome(noteId: string): Promise<Misskey.entities.Note> {
			const uri = `https://b.test/notes/${noteId}`;
			return await vi.waitFor(async () => {
				const notes = await alice.client.request('notes/timeline', { limit: 100 });
				const found = notes.find(n => n.uri === uri);
				assert(found != null);
				return found;
			}, WAIT_FOR_FEDERATION);
		}

		async function channelTimelineHas(channelId: string, uri: string): Promise<boolean> {
			const notes = await alice.client.request('channels/timeline', { channelId, limit: 100 });
			return notes.some(n => n.uri === uri);
		}

		beforeAll(async () => {
			channel = await createChannel(alice, 'public');
			assert(channel.federationHashtag != null);
			hashtag = channel.federationHashtag;
		});

		test('H1: ハッシュタグにサーバー名は入らず、相手のサーバーの同じ名前の連合するチャンネルと、互いのノートを収蔵しあう', async () => {
			const channelInA = await createChannel(alice, 'public');
			const channelInB = await bob.client.request('channels/create', { name: channelInA.name, federationPolicy: 'public' });
			strictEqual(channelInA.federationHashtag, `連合チャンネル_${channelInA.name.replace(/[^\p{L}\p{N}_]/gu, '')}`);
			strictEqual(channelInB.federationHashtag, channelInA.federationHashtag);

			// a.test のチャンネルのノートは、b.test の同じ名前のチャンネルに入る
			const fromA = await postToChannel(alice, channelInA.id);
			await vi.waitFor(async () => {
				const notes = await bob.client.request('channels/timeline', { channelId: channelInB.id, limit: 100 });
				const found = notes.find(n => n.uri === `https://a.test/notes/${fromA.id}`);
				assert(found != null);
				assert((found.tags ?? []).includes(channelInA.federationHashtag!.toLowerCase()), JSON.stringify(found.tags));
			}, WAIT_FOR_FEDERATION);

			// b.test のチャンネルのノートは、a.test の同じ名前のチャンネルに入る
			const fromB = await postToChannel(bob, channelInB.id);
			await vi.waitFor(async () => {
				assert(await channelTimelineHas(channelInA.id, `https://b.test/notes/${fromB.id}`));
			}, WAIT_FOR_FEDERATION);
		});

		test('H2: 相手に同じ名前のチャンネルがなくても、ハッシュタグは相手のノートの tags に入り、ハッシュタグの検索に出る', async () => {
			const note = await postToChannel(alice, channel.id);
			deepStrictEqual(note.tags, [hashtag.toLowerCase()]);
			const noteInB = await waitForNoteInBobHome(note.id);

			strictEqual(noteInB.channelId ?? null, null);
			assert(noteInB.text?.endsWith(`\n\n#${hashtag}`), `unexpected text: ${noteInB.text}`);
			deepStrictEqual(noteInB.tags, [hashtag.toLowerCase()]);

			const searched = await bob.client.request('notes/search-by-tag', { tag: hashtag, limit: 100 });
			assert(searched.some(n => n.uri === noteInB.uri));
		});

		test('H3: 相手のユーザーがハッシュタグを付けて公開で投稿すると、チャンネルに入る', async () => {
			const posted = (await bob.client.request('notes/create', { text: `${crypto.randomUUID()} #${hashtag}` })).createdNote;
			const uri = `https://b.test/notes/${posted.id}`;

			const inA = await vi.waitFor(async () => {
				const notes = await alice.client.request('channels/timeline', { channelId: channel.id, limit: 100 });
				const found = notes.find(n => n.uri === uri);
				assert(found != null);
				return found;
			}, WAIT_FOR_FEDERATION);
			strictEqual(inA.channelId, channel.id);
		});

		test('H4: ホーム・フォロワー限定のノートは、ハッシュタグがあってもチャンネルに入らない', async () => {
			for (const visibility of ['home', 'followers'] as const) {
				const posted = (await bob.client.request('notes/create', { text: `${crypto.randomUUID()} #${hashtag}`, visibility })).createdNote;
				const inA = await waitForBobNoteInAliceHome(posted.id);
				strictEqual(inA.channelId ?? null, null, visibility);
				strictEqual(await channelTimelineHas(channel.id, inA.uri!), false, visibility);
			}
		});

		test('H5: 連合しないチャンネルのハッシュタグでは、チャンネルに入らない', async () => {
			const disabled = await createChannel(alice, 'public');
			await alice.client.request('channels/update', { channelId: disabled.id, federationPolicy: 'none' });

			const posted = (await bob.client.request('notes/create', { text: `${crypto.randomUUID()} #${disabled.federationHashtag}` })).createdNote;
			const inA = await waitForBobNoteInAliceHome(posted.id);
			strictEqual(inA.channelId ?? null, null);
			strictEqual(await channelTimelineHas(disabled.id, inA.uri!), false);
		});

		test('H7: 収蔵された bob のノートは、bob をフォローしている alice のホーム・ソーシャルに既定では出て、withCollectedChannelNotes: false では出ない', async () => {
			// alice がフォローしていないチャンネル (carol のもの) に収蔵させる
			const carolChannel = await createChannel(carol, 'public');
			const posted = (await bob.client.request('notes/create', { text: `${crypto.randomUUID()} #${carolChannel.federationHashtag}` })).createdNote;
			const uri = `https://b.test/notes/${posted.id}`;

			const inA = await vi.waitFor(async () => {
				const notes = await carol.client.request('channels/timeline', { channelId: carolChannel.id, limit: 100 });
				const found = notes.find(n => n.uri === uri);
				assert(found != null);
				return found;
			}, WAIT_FOR_FEDERATION);
			strictEqual(inA.channelId, carolChannel.id);

			const home = await alice.client.request('notes/timeline', { limit: 100 });
			assert(home.some(n => n.uri === uri), 'notes/timeline (既定)');
			const homeWithout = await alice.client.request('notes/timeline', { limit: 100, withCollectedChannelNotes: false });
			strictEqual(homeWithout.some(n => n.uri === uri), false, 'notes/timeline (false)');

			const social = await alice.client.request('notes/hybrid-timeline', { limit: 100 });
			assert(social.some(n => n.uri === uri), 'notes/hybrid-timeline (既定)');
			const socialWithout = await alice.client.request('notes/hybrid-timeline', { limit: 100, withCollectedChannelNotes: false });
			strictEqual(socialWithout.some(n => n.uri === uri), false, 'notes/hybrid-timeline (false)');

			// bob をフォローしていない carol のホームには出ない
			const carolHome = await carol.client.request('notes/timeline', { limit: 100 });
			strictEqual(carolHome.some(n => n.uri === uri), false, 'carol の notes/timeline');
		});

		test('H6: a.test のトレンドに、チャンネルのハッシュタグは出ない', async () => {
			const plainTag = `plain${crypto.randomUUID().substring(0, 8)}`;
			const posted = (await bob.client.request('notes/create', { text: `${crypto.randomUUID()} #${plainTag} #${hashtag}` })).createdNote;
			// チャンネルに収蔵されるので、alice のホームではなくチャンネルのタイムラインで届いたことを確かめる
			await vi.waitFor(async () => {
				assert(await channelTimelineHas(channel.id, `https://b.test/notes/${posted.id}`));
			}, WAIT_FOR_FEDERATION);

			await vi.waitFor(async () => {
				const trend = await alice.client.request('hashtags/trend', {});
				const tags = trend.map(t => t.tag);
				// 同じノートに付けたふつうのハッシュタグは数えられている (集計そのものは動いている)
				assert(tags.includes(plainTag.toLowerCase()), JSON.stringify(tags));
				strictEqual(tags.some(tag => tag.includes('連合チャンネル_')), false, JSON.stringify(tags));
			}, WAIT_FOR_FEDERATION);
		});
	});
});
