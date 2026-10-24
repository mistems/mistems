/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, beforeEach, test, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { RemoteNoteReactionSyncService } from '@/core/activitypub/RemoteNoteReactionSyncService.js';
import type { MiNote } from '@/models/Note.js';

/**
 * RemoteNoteReactionSyncService.syncReactions の unit テスト。
 * DI を立ち上げず、相手の API の応答は httpRequestService.send のモックで置き換える。
 */

function makeRemoteNote(overrides: Partial<MiNote> = {}): MiNote {
	return {
		id: 'note1',
		uri: 'https://misskey.systems/notes/asq39a3cb0',
		userHost: 'misskey.systems',
		reactions: {},
		...overrides,
	} as unknown as MiNote;
}

function jsonResponse(body: unknown) {
	return { json: async () => body };
}

describe('RemoteNoteReactionSyncService.syncReactions', () => {
	let service: RemoteNoteReactionSyncService;
	let current: MiNote;
	let queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
	let notesRepository: { findOneBy: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
	let emojisRepository: { findBy: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
	let httpRequestService: { send: ReturnType<typeof vi.fn> };
	let federatedInstanceService: { fetch: ReturnType<typeof vi.fn> };
	let customEmojiService: { invalidateRemoteEmojiCache: ReturnType<typeof vi.fn> };
	let consumeBudget: Mock<(host: string) => Promise<boolean>>;
	let remoteApi: Record<string, unknown>;
	let rowCounts: { reaction: string; count: string }[];
	let noteReactionsRepository: {
		exists: ReturnType<typeof vi.fn>;
		findOneBy: ReturnType<typeof vi.fn>;
		createQueryBuilder: ReturnType<typeof vi.fn>;
	};
	let usersRepository: { findOneBy: ReturnType<typeof vi.fn> };
	let reactionService: { create: ReturnType<typeof vi.fn> };
	let remoteUserResolveService: { resolveUser: ReturnType<typeof vi.fn> };
	let reactionsBufferingService: { get: ReturnType<typeof vi.fn> };
	let meta: { enableReactionsBuffering: boolean };
	let knownUsers: Record<string, { id: string; host: string; isSuspended: boolean }>;
	let createdReactions: Map<string, string>;

	beforeEach(() => {
		current = makeRemoteNote();
		queryBuilder = {};
		for (const m of ['update', 'set', 'where', 'setParameters']) queryBuilder[m] = vi.fn(() => queryBuilder);
		queryBuilder.execute = vi.fn(async () => undefined);

		notesRepository = {
			findOneBy: vi.fn(async () => current),
			createQueryBuilder: vi.fn(() => queryBuilder),
		};
		emojisRepository = {
			findBy: vi.fn(async () => []),
			insert: vi.fn(async () => undefined),
		};
		remoteApi = {
			'https://misskey.systems/api/notes/show': {
				id: 'asq39a3cb0',
				reactions: { ':owa_desuwa@.:': 2, '👍': 1, ':blobcat@other.example:': 1 },
				// 第三のホストの絵文字の URL は相手の言い分なので使わない
				reactionEmojis: { 'blobcat@other.example': 'https://evil.example/fake.png' },
			},
			'https://misskey.systems/api/emoji': { name: 'owa_desuwa', url: 'https://misskey.systems/files/owa_desuwa.png', license: null },
			'https://other.example/api/emoji': { name: 'blobcat', url: 'https://other.example/files/blobcat.png', license: 'CC0' },
			'https://misskey.systems/api/notes/reactions': [],
		};
		httpRequestService = {
			send: vi.fn(async (url: string) => jsonResponse(remoteApi[url])),
		};
		federatedInstanceService = {
			fetch: vi.fn(async () => ({ softwareName: 'misskey' })),
		};
		customEmojiService = { invalidateRemoteEmojiCache: vi.fn() };
		consumeBudget = vi.fn(async (_host: string) => true);

		rowCounts = [];
		createdReactions = new Map();
		const rowQueryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
		for (const m of ['select', 'addSelect', 'where', 'groupBy']) rowQueryBuilder[m] = vi.fn(() => rowQueryBuilder);
		rowQueryBuilder.getRawMany = vi.fn(async () => rowCounts);
		noteReactionsRepository = {
			exists: vi.fn(async ({ where }: { where: { userId: string } }) => createdReactions.has(where.userId)),
			findOneBy: vi.fn(async ({ userId }: { userId: string }) => {
				const reaction = createdReactions.get(userId);
				return reaction != null ? { userId, reaction } : null;
			}),
			createQueryBuilder: vi.fn(() => rowQueryBuilder),
		};
		knownUsers = {};
		usersRepository = {
			findOneBy: vi.fn(async ({ usernameLower, host }: { usernameLower: string; host: string }) => knownUsers[`${usernameLower}@${host}`] ?? null),
		};
		reactionService = {
			create: vi.fn(async (user: { id: string; host: string }, _note: MiNote, reaction: string) => {
				// ReactionService.create と同じく、付けたユーザーのホストの絵文字として保存する
				const stored = reaction.match(/^:([\w+-]+):$/) ? `:${reaction.slice(1, -1)}@${user.host}:` : reaction;
				createdReactions.set(user.id, stored);
			}),
		};
		remoteUserResolveService = {
			resolveUser: vi.fn(async (username: string, host: string) => ({ id: `resolved-${username}@${host}`, host, isSuspended: false })),
		};
		reactionsBufferingService = { get: vi.fn(async () => ({ deltas: {}, pairs: [] })) };
		meta = { enableReactionsBuffering: false };

		const moduleRef = {
			get: (name: string) => ({
				ReactionService: reactionService,
				ReactionsBufferingService: reactionsBufferingService,
				RemoteUserResolveService: remoteUserResolveService,
			} as Record<string, unknown>)[name],
		};

		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		service = new RemoteNoteReactionSyncService(
			moduleRef as never,
			{ host: 'gamelore.example' } as never,
			meta as never,
			notesRepository as never,
			noteReactionsRepository as never,
			usersRepository as never,
			emojisRepository as never,
			httpRequestService as never,
			federatedInstanceService as never,
			{
				extractDbHost: (uri: string) => new URL(uri).host,
				isFederationAllowedHost: () => true,
				toPuny: (host: string) => host.toLowerCase(),
			} as never,
			{ gen: () => 'emojiid' } as never,
			customEmojiService as never,
			{ logger: { createSubLogger: () => logger } } as never,
		);
		service.onModuleInit();
	});

	test('Misskey 系の相手: notes/show を読み、増えたキーを GREATEST で更新する', async () => {
		current = makeRemoteNote({ reactions: { '👍': 3 } });
		const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(true);

		const [url, args] = httpRequestService.send.mock.calls[0];
		expect(url).toBe('https://misskey.systems/api/notes/show');
		expect(JSON.parse(args.body)).toEqual({ noteId: 'asq39a3cb0' });

		const params = queryBuilder.setParameters.mock.calls[0][0];
		const pairs = Object.fromEntries(Object.keys(params).filter(k => k.startsWith('reaction')).map(k => [params[k], params[k.replace('reaction', 'count')]]));
		// 👍 は自分の数 (3) が多いので更新しない
		expect(pairs).toEqual({ ':owa_desuwa@misskey.systems:': 2, ':blobcat@other.example:': 1 });
		const sql = queryBuilder.set.mock.calls[0][0].reactions();
		expect(sql).toContain('GREATEST');
	});

	test('リアクションの絵文字を、その絵文字のホスト自身の emoji API から取って登録する', async () => {
		await service.syncReactions(makeRemoteNote(), { consumeBudget });
		const inserted = emojisRepository.insert.mock.calls.map(c => c[0]);
		expect(inserted).toEqual(expect.arrayContaining([
			expect.objectContaining({ host: 'misskey.systems', name: 'owa_desuwa', originalUrl: 'https://misskey.systems/files/owa_desuwa.png' }),
			expect.objectContaining({ host: 'other.example', name: 'blobcat', originalUrl: 'https://other.example/files/blobcat.png', license: 'CC0' }),
		]));
		expect(inserted).toHaveLength(2);
		expect(customEmojiService.invalidateRemoteEmojiCache).toHaveBeenCalledWith('owa_desuwa', 'misskey.systems');
		// 上限は、リクエストを送るホストごとに数える
		expect(consumeBudget.mock.calls.map(c => c[0])).toEqual(['misskey.systems', 'misskey.systems', 'other.example', 'misskey.systems']);
	});

	test('第三のホストの絵文字を、相手の reactionEmojis の URL では登録しない', async () => {
		// 第三のホストが Misskey 系でないときは、登録せずに数だけを反映する
		federatedInstanceService.fetch.mockImplementation(async (host: string) => ({ softwareName: host === 'other.example' ? 'mastodon' : 'misskey' }));
		const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(true);
		const inserted = emojisRepository.insert.mock.calls.map(c => c[0]);
		expect(inserted).toEqual([expect.objectContaining({ host: 'misskey.systems', name: 'owa_desuwa' })]);
		expect(inserted.some((e: { originalUrl: string }) => e.originalUrl.includes('evil.example'))).toBe(false);
		expect(httpRequestService.send.mock.calls.map(c => c[0])).not.toContain('https://other.example/api/emoji');
		const params = queryBuilder.setParameters.mock.calls[0][0];
		expect(Object.values(params)).toContain(':blobcat@other.example:');
	});

	test('第三のホストの上限に当たったら、その絵文字は取らない', async () => {
		consumeBudget.mockImplementation(async (host: string) => host !== 'other.example');
		await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(httpRequestService.send.mock.calls.map(c => c[0])).not.toContain('https://other.example/api/emoji');
		expect(emojisRepository.insert).toHaveBeenCalledTimes(1);
	});

	test('emoji API が別の名前を返したら登録しない', async () => {
		remoteApi['https://misskey.systems/api/emoji'] = { name: 'other', url: 'https://misskey.systems/files/x.png' };
		await service.syncReactions(makeRemoteNote(), { consumeBudget });
		const inserted = emojisRepository.insert.mock.calls.map(c => c[0]);
		expect(inserted.some((e: { host: string }) => e.host === 'misskey.systems')).toBe(false);
	});

	test('登録済みの絵文字は取り直さない', async () => {
		emojisRepository.findBy.mockImplementation(async ({ host }: { host: string }) => [{ name: host === 'misskey.systems' ? 'owa_desuwa' : 'blobcat' }]);
		await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(emojisRepository.insert).not.toHaveBeenCalled();
		expect(httpRequestService.send.mock.calls.map(c => c[0])).toEqual([
			'https://misskey.systems/api/notes/show',
			'https://misskey.systems/api/notes/reactions',
		]);
	});

	test('相手が Misskey 系でないとき (Mastodon) は何もしない', async () => {
		federatedInstanceService.fetch.mockImplementation(async () => ({ softwareName: 'mastodon' }));
		const res = await service.syncReactions(makeRemoteNote({ uri: 'https://misskey.systems/notes/asq39a3cb0' }), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
		expect(consumeBudget).not.toHaveBeenCalled();
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});

	test('URI が /notes/<id> の形でないときは何もしない', async () => {
		const res = await service.syncReactions(makeRemoteNote({ uri: 'https://misskey.systems/users/1/statuses/2' }), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('上限に当たったら相手の API を呼ばない', async () => {
		consumeBudget.mockImplementation(async () => false);
		const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('数が変わらないときは更新しない', async () => {
		current = makeRemoteNote({ reactions: { ':owa_desuwa@misskey.systems:': 2, '👍': 1, ':blobcat@other.example:': 1 } });
		const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(false);
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});

	test('notes/show が失敗したら例外を投げる (呼び出し元で warn に残す)', async () => {
		httpRequestService.send.mockImplementationOnce(async () => { throw new Error('500 Internal Server Error'); });
		await expect(service.syncReactions(makeRemoteNote(), { consumeBudget })).rejects.toThrow('500');
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});

	describe('誰が付けたか (notes/reactions)', () => {
		const reactionsUrl = 'https://misskey.systems/api/notes/reactions';

		function sqlCalls() {
			return queryBuilder.set.mock.calls.map((c, i) => ({
				sql: c[0].reactions() as string,
				params: queryBuilder.setParameters.mock.calls[i][0] as Record<string, string | number>,
			}));
		}

		function pairsOf(params: Record<string, string | number>) {
			return Object.fromEntries(Object.keys(params).filter(k => k.startsWith('reaction')).map(k => [params[k], params[k.replace('reaction', 'count')]]));
		}

		beforeEach(() => {
			knownUsers['alice@misskey.systems'] = { id: 'alice', host: 'misskey.systems', isSuspended: false };
			remoteApi[reactionsUrl] = [
				{ id: 'r1', user: { username: 'alice', host: null }, type: ':owa_desuwa@.:' },
				{ id: 'r2', user: { username: 'bob', host: null }, type: '👍' },
			];
		});

		test('付けたユーザーを解決して ReactionService.create で行を作る', async () => {
			await service.syncReactions(makeRemoteNote(), { consumeBudget });

			// 既にいるユーザーは解決しない。知らないユーザーだけ解決する
			expect(remoteUserResolveService.resolveUser).toHaveBeenCalledTimes(1);
			expect(remoteUserResolveService.resolveUser).toHaveBeenCalledWith('bob', 'misskey.systems');

			expect(reactionService.create).toHaveBeenCalledTimes(2);
			expect(reactionService.create.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'alice' }));
			expect(reactionService.create.mock.calls[0][2]).toBe(':owa_desuwa:');
			expect(reactionService.create.mock.calls[1][2]).toBe('👍');

			const [, args] = httpRequestService.send.mock.calls.find(c => c[0] === reactionsUrl)!;
			expect(JSON.parse(args.body)).toEqual({ noteId: 'asq39a3cb0', limit: 100 });
		});

		test('数を二重に数えない (create で増えた分を引き戻してから、相手の数に合わせる)', async () => {
			rowCounts = [
				{ reaction: ':owa_desuwa@misskey.systems:', count: '1' },
				{ reaction: '👍', count: '1' },
			];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });

			const calls = sqlCalls();
			expect(calls).toHaveLength(2);
			// 1 回目: create で増やした分を引く
			expect(calls[0].sql).toContain(' - :count');
			expect(pairsOf(calls[0].params)).toEqual({ ':owa_desuwa@misskey.systems:': 1, '👍': 1 });
			// 2 回目: 相手の数 (と行の数) の max に合わせる
			expect(calls[1].sql).toContain('GREATEST');
			expect(pairsOf(calls[1].params)).toEqual({ ':owa_desuwa@misskey.systems:': 2, '👍': 1, ':blobcat@other.example:': 1 });
		});

		test('行の数が相手の数より多いときは、行の数に合わせる', async () => {
			rowCounts = [{ reaction: '🎉', count: '3' }];
			remoteApi[reactionsUrl] = [];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			const calls = sqlCalls();
			expect(pairsOf(calls.at(-1)!.params)['🎉']).toBe(3);
		});

		test('バッファリングが有効なときは、まだ書き込まれていない差分を引いて合わせる', async () => {
			meta.enableReactionsBuffering = true;
			reactionsBufferingService.get.mockImplementation(async () => ({ deltas: { ':owa_desuwa@misskey.systems:': 1 }, pairs: [] }));
			remoteApi[reactionsUrl] = [];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(pairsOf(sqlCalls().at(-1)!.params)[':owa_desuwa@misskey.systems:']).toBe(1);
		});

		test('既にリアクションがあるユーザーは二重に作らない', async () => {
			createdReactions.set('alice', ':owa_desuwa@misskey.systems:');
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(reactionService.create.mock.calls.map(c => c[0].id)).toEqual(['resolved-bob@misskey.systems']);
		});

		test('2 回同期しても行を二重に作らない', async () => {
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(reactionService.create).toHaveBeenCalledTimes(2);
		});

		test('ホストの上限に当たったら、そこで取り込みを止めて数だけを反映する', async () => {
			knownUsers['carol@misskey.systems'] = { id: 'carol', host: 'misskey.systems', isSuspended: false };
			(remoteApi[reactionsUrl] as unknown[]).push({ id: 'r3', user: { username: 'carol', host: null }, type: '👍' });
			// notes/show・emoji・notes/reactions の 3 回で misskey.systems の上限に当たる
			let n = 0;
			consumeBudget.mockImplementation(async (host: string) => host !== 'misskey.systems' || ++n <= 3);

			const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(res).toBe(true);
			expect(remoteUserResolveService.resolveUser).not.toHaveBeenCalled();
			// bob で止まるので carol も取り込まない
			expect(reactionService.create.mock.calls.map(c => c[0].id)).toEqual(['alice']);
			expect(pairsOf(sqlCalls().at(-1)!.params)).toEqual(expect.objectContaining({ ':owa_desuwa@misskey.systems:': 2 }));
		});

		test('notes/reactions のページの前に上限に当たったら、取り込まずに数だけを反映する', async () => {
			let calls = 0;
			consumeBudget.mockImplementation(async (host: string) => host !== 'misskey.systems' || ++calls <= 2);
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(httpRequestService.send.mock.calls.map(c => c[0])).not.toContain(reactionsUrl);
			expect(reactionService.create).not.toHaveBeenCalled();
			expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
		});

		test('100 件のページなら untilId で次のページを読む', async () => {
			const page = Array.from({ length: 100 }, (_, i) => {
				knownUsers[`u${i}@misskey.systems`] = { id: `u${i}`, host: 'misskey.systems', isSuspended: false };
				return { id: `r${i}`, user: { username: `u${i}`, host: null }, type: '👍' };
			});
			httpRequestService.send.mockImplementation(async (url: string, args: { body: string }) => {
				if (url !== reactionsUrl) return jsonResponse(remoteApi[url]);
				return jsonResponse(JSON.parse(args.body).untilId == null ? page : []);
			});
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			const bodies = httpRequestService.send.mock.calls.filter(c => c[0] === reactionsUrl).map(c => JSON.parse(c[1].body));
			expect(bodies).toEqual([{ noteId: 'asq39a3cb0', limit: 100 }, { noteId: 'asq39a3cb0', limit: 100, untilId: 'r99' }]);
			expect(reactionService.create).toHaveBeenCalledTimes(100);
		});

		test('自分のサーバーのユーザーと、凍結されたユーザーは取り込まない', async () => {
			knownUsers['mallory@misskey.systems'] = { id: 'mallory', host: 'misskey.systems', isSuspended: true };
			remoteApi[reactionsUrl] = [
				{ id: 'r1', user: { username: 'me', host: 'gamelore.example' }, type: '👍' },
				{ id: 'r2', user: { username: 'mallory', host: null }, type: '👍' },
			];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(reactionService.create).not.toHaveBeenCalled();
			expect(remoteUserResolveService.resolveUser).not.toHaveBeenCalled();
		});

		test('第三のホストのユーザーを名乗るエントリは、行を作らない (なりすまし対策)', async () => {
			knownUsers['bob@other.example'] = { id: 'bob-other', host: 'other.example', isSuspended: false };
			remoteApi[reactionsUrl] = [
				{ id: 'r1', user: { username: 'bob', host: 'other.example' }, type: ':blobcat@other.example:' },
				{ id: 'r2', user: { username: 'carol', host: 'third.example' }, type: '👍' },
			];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(reactionService.create).not.toHaveBeenCalled();
			expect(remoteUserResolveService.resolveUser).not.toHaveBeenCalled();
			expect(consumeBudget.mock.calls.map(c => c[0])).not.toContain('third.example');
		});

		test('自分のサーバーのローカルユーザーを名乗るエントリは、行を作らない (なりすまし対策)', async () => {
			knownUsers['admin@gamelore.example'] = { id: 'local-admin', host: null as never, isSuspended: false };
			remoteApi[reactionsUrl] = [
				{ id: 'r1', user: { username: 'admin', host: 'gamelore.example' }, type: '👍' },
				{ id: 'r2', user: { username: 'admin', host: 'GAMELORE.example' }, type: '👍' },
			];
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(reactionService.create).not.toHaveBeenCalled();
			expect(usersRepository.findOneBy).not.toHaveBeenCalled();
		});

		test('WebFinger で別のホスト (自分のサーバーを含む) のユーザーに解決されたときは、行を作らない', async () => {
			remoteApi[reactionsUrl] = [
				{ id: 'r1', user: { username: 'eve', host: null }, type: '👍' },
				{ id: 'r2', user: { username: 'mallet', host: null }, type: '👍' },
			];
			remoteUserResolveService.resolveUser.mockImplementation(async (username: string) => (username === 'eve'
				? { id: 'eve', host: 'other.example', isSuspended: false }
				: { id: 'local-mallet', host: null, isSuspended: false }));
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(remoteUserResolveService.resolveUser).toHaveBeenCalledTimes(2);
			expect(reactionService.create).not.toHaveBeenCalled();
		});

		test('create が弾いたもの (ブロックなど) は捨て、数も引き戻さない', async () => {
			const { IdentifiableError } = await import('@/misc/identifiable-error.js');
			reactionService.create.mockImplementation(async () => { throw new IdentifiableError('e70412a4-7197-4726-8e74-f3e0deb92aa7'); });
			await service.syncReactions(makeRemoteNote(), { consumeBudget });
			const calls = sqlCalls();
			expect(calls.every(c => !c.sql.includes(' - :count'))).toBe(true);
		});

		test('notes/reactions が失敗しても、数の同期は続ける', async () => {
			remoteApi[reactionsUrl] = { error: 'oops' };
			const res = await service.syncReactions(makeRemoteNote(), { consumeBudget });
			expect(res).toBe(true);
			expect(reactionService.create).not.toHaveBeenCalled();
		});
	});
});
