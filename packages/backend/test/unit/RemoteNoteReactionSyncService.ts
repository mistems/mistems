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
 * RemoteNoteReactionSyncService.syncReactionCounts の unit テスト。
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

describe('RemoteNoteReactionSyncService.syncReactionCounts', () => {
	let service: RemoteNoteReactionSyncService;
	let current: MiNote;
	let queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
	let notesRepository: { findOneBy: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
	let emojisRepository: { findBy: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
	let httpRequestService: { send: ReturnType<typeof vi.fn> };
	let federatedInstanceService: { fetch: ReturnType<typeof vi.fn> };
	let customEmojiService: { invalidateRemoteEmojiCache: ReturnType<typeof vi.fn> };
	let consumeBudget: Mock<() => Promise<boolean>>;
	let remoteApi: Record<string, unknown>;

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
			'notes/show': {
				id: 'asq39a3cb0',
				reactions: { ':owa_desuwa@.:': 2, '👍': 1, ':blobcat@other.example:': 1 },
				reactionEmojis: { 'blobcat@other.example': 'https://other.example/emoji/blobcat.png' },
			},
			'emoji': { name: 'owa_desuwa', url: 'https://misskey.systems/files/owa_desuwa.png', license: null },
		};
		httpRequestService = {
			send: vi.fn(async (url: string) => {
				const endpoint = url.replace('https://misskey.systems/api/', '');
				return jsonResponse(remoteApi[endpoint]);
			}),
		};
		federatedInstanceService = {
			fetch: vi.fn(async () => ({ softwareName: 'misskey' })),
		};
		customEmojiService = { invalidateRemoteEmojiCache: vi.fn() };
		consumeBudget = vi.fn(async () => true);

		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		service = new RemoteNoteReactionSyncService(
			{ host: 'gamelore.example' } as never,
			notesRepository as never,
			emojisRepository as never,
			httpRequestService as never,
			federatedInstanceService as never,
			{
				extractDbHost: (uri: string) => new URL(uri).host,
				isFederationAllowedHost: () => true,
			} as never,
			{ gen: () => 'emojiid' } as never,
			customEmojiService as never,
			{ logger: { createSubLogger: () => logger } } as never,
		);
	});

	test('Misskey 系の相手: notes/show を読み、増えたキーを GREATEST で更新する', async () => {
		current = makeRemoteNote({ reactions: { '👍': 3 } });
		const res = await service.syncReactionCounts(makeRemoteNote(), { consumeBudget });
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

	test('リアクションの絵文字を登録する (相手自身の絵文字は emoji API から URL を取る)', async () => {
		await service.syncReactionCounts(makeRemoteNote(), { consumeBudget });
		const inserted = emojisRepository.insert.mock.calls.map(c => c[0]);
		expect(inserted).toEqual(expect.arrayContaining([
			expect.objectContaining({ host: 'misskey.systems', name: 'owa_desuwa', originalUrl: 'https://misskey.systems/files/owa_desuwa.png' }),
			expect.objectContaining({ host: 'other.example', name: 'blobcat', originalUrl: 'https://other.example/emoji/blobcat.png' }),
		]));
		expect(customEmojiService.invalidateRemoteEmojiCache).toHaveBeenCalledWith('owa_desuwa', 'misskey.systems');
		// notes/show と emoji の 2 回を上限に数える
		expect(consumeBudget).toHaveBeenCalledTimes(2);
	});

	test('登録済みの絵文字は取り直さない', async () => {
		emojisRepository.findBy.mockImplementation(async ({ host }: { host: string }) => [{ name: host === 'misskey.systems' ? 'owa_desuwa' : 'blobcat' }]);
		await service.syncReactionCounts(makeRemoteNote(), { consumeBudget });
		expect(emojisRepository.insert).not.toHaveBeenCalled();
		expect(httpRequestService.send).toHaveBeenCalledTimes(1);
	});

	test('相手が Misskey 系でないとき (Mastodon) は何もしない', async () => {
		federatedInstanceService.fetch.mockImplementation(async () => ({ softwareName: 'mastodon' }));
		const res = await service.syncReactionCounts(makeRemoteNote({ uri: 'https://misskey.systems/notes/asq39a3cb0' }), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
		expect(consumeBudget).not.toHaveBeenCalled();
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});

	test('URI が /notes/<id> の形でないときは何もしない', async () => {
		const res = await service.syncReactionCounts(makeRemoteNote({ uri: 'https://misskey.systems/users/1/statuses/2' }), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('上限に当たったら相手の API を呼ばない', async () => {
		consumeBudget.mockImplementation(async () => false);
		const res = await service.syncReactionCounts(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(false);
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('数が変わらないときは更新しない', async () => {
		current = makeRemoteNote({ reactions: { ':owa_desuwa@misskey.systems:': 2, '👍': 1, ':blobcat@other.example:': 1 } });
		const res = await service.syncReactionCounts(makeRemoteNote(), { consumeBudget });
		expect(res).toBe(false);
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});

	test('notes/show が失敗したら例外を投げる (呼び出し元で warn に残す)', async () => {
		httpRequestService.send.mockImplementationOnce(async () => { throw new Error('500 Internal Server Error'); });
		await expect(service.syncReactionCounts(makeRemoteNote(), { consumeBudget })).rejects.toThrow('500');
		expect(queryBuilder.execute).not.toHaveBeenCalled();
	});
});
