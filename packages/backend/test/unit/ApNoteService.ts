/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, beforeEach, test, expect, vi } from 'vitest';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import type { MiNote } from '@/models/Note.js';
import type { IPost } from '@/core/activitypub/type.js';

/**
 * ApNoteService.updateNoteIfStale の振る舞いを検証する unit テスト。
 *
 * DI を立ち上げず ApNoteService を直接インスタンス化し、updateNoteIfStale が触れる
 * 依存だけをモックする (AP の実フェッチは resolver.resolve のモックで置き換える)。
 * 分散ロック (acquireApObjectLock) は Redis 実体を避けるためモジュールごとモックする。
 *
 * NOTE: backend テストは `.config/test.yml` + Postgres/Redis を要求するため、この環境では
 * 実行できない可能性がある (型・構文の整合のみ担保)。
 */

// 分散ロックは no-op の unlock を返すようモック (Redis 不要)
vi.mock('@/misc/distributed-lock.js', () => ({
	acquireApObjectLock: vi.fn(async () => () => { /* unlock noop */ }),
}));

// updateNoteIfStale 内の TTL 定数 (ApNoteService 内の NOTE_REFETCH_TTL と一致させる)
const TTL = 1000 * 60 * 60 * 4;

function makeRemoteNote(overrides: Partial<MiNote> = {}): MiNote {
	return {
		id: 'note1',
		uri: 'https://remote.example.com/notes/1',
		userHost: 'remote.example.com',
		lastFetchedAt: null,
		refetchedCount: 0,
		cw: null,
		text: 'hello',
		...overrides,
	} as unknown as MiNote;
}

describe('ApNoteService.updateNoteIfStale', () => {
	let service: ApNoteService;

	let notesRepository: {
		update: ReturnType<typeof vi.fn>;
		increment: ReturnType<typeof vi.fn>;
		findOneBy: ReturnType<typeof vi.fn>;
		findOneByOrFail: ReturnType<typeof vi.fn>;
	};
	let emojisRepository: { findBy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
	let utilityService: {
		isFederationAllowedUri: ReturnType<typeof vi.fn>;
		extractDbHost: ReturnType<typeof vi.fn>;
		toPuny: ReturnType<typeof vi.fn>;
	};
	let redisClient: { incr: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };
	let resolver: { resolve: ReturnType<typeof vi.fn> };
	let apResolverService: { createResolver: ReturnType<typeof vi.fn> };
	let globalEventService: { publishNoteStream: ReturnType<typeof vi.fn> };
	let apLoggerService: { logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } };

	beforeEach(() => {
		const resolvedObject = {
			id: 'https://remote.example.com/notes/1',
			type: 'Note',
			attributedTo: 'https://remote.example.com/users/1',
			content: '<p>updated</p>',
			tag: [],
		} as unknown as IPost;

		resolver = {
			resolve: vi.fn(async () => resolvedObject),
		};

		notesRepository = {
			update: vi.fn(async () => undefined),
			increment: vi.fn(async () => undefined),
			// double-checked locking 用の再読込: 直前に他プロセスが更新していない想定で渡されたノート相当を返す
			findOneBy: vi.fn(async () => makeRemoteNote()),
			// updateNote の最後で返す「最新ノート」
			findOneByOrFail: vi.fn(async () => makeRemoteNote({ cw: null, text: 'updated' })),
		};

		emojisRepository = {
			findBy: vi.fn(async () => []),
			update: vi.fn(async () => undefined),
		};

		utilityService = {
			isFederationAllowedUri: vi.fn(() => true),
			extractDbHost: vi.fn(() => 'remote.example.com'),
			toPuny: vi.fn((h: string) => h),
		};

		redisClient = {
			incr: vi.fn(async () => 1),
			expire: vi.fn(async () => 1),
		};

		apResolverService = {
			createResolver: vi.fn(() => resolver),
		};

		globalEventService = {
			publishNoteStream: vi.fn(),
		};

		apLoggerService = {
			logger: { debug: vi.fn(), error: vi.fn() },
		};

		// updateNoteIfStale / updateNote が参照する依存のみ注入する。
		// 残りの constructor 引数は当該メソッドでは未使用なので空オブジェクトで足りる。
		service = new ApNoteService(
			{} as never, // config
			{} as never, // meta
			redisClient as never,
			{} as never, // pollsRepository
			emojisRepository as never,
			notesRepository as never,
			{} as never, // idService
			{} as never, // apMfmService
			apResolverService as never,
			{} as never, // apPersonService
			utilityService as never,
			{} as never, // apAudienceService
			{} as never, // apMentionService
			{} as never, // apImageService
			{} as never, // apQuestionService
			{} as never, // pollService
			{} as never, // noteCreateService
			{} as never, // apDbResolverService
			{} as never, // customEmojiService
			globalEventService as never,
			apLoggerService as never,
		);
	});

	test('ローカルノート (uri==null) は対象外でそのまま返る', async () => {
		const local = makeRemoteNote({ uri: null });
		const res = await service.updateNoteIfStale(local);
		expect(res).toBe(local);
		expect(resolver.resolve).not.toHaveBeenCalled();
	});

	test('TTL ガード: lastFetchedAt が TTL 内 (force なし) なら resolve せず現状ノートを返す', async () => {
		const fresh = makeRemoteNote({ lastFetchedAt: new Date(Date.now() - TTL / 2) });
		const res = await service.updateNoteIfStale(fresh);
		expect(res).toBe(fresh);
		expect(resolver.resolve).not.toHaveBeenCalled();
		expect(notesRepository.increment).not.toHaveBeenCalled();
	});

	test('TTL 切れ (lastFetchedAt==null): resolve が 1 回呼ばれる', async () => {
		const stale = makeRemoteNote({ lastFetchedAt: null });
		await service.updateNoteIfStale(stale);
		expect(resolver.resolve).toHaveBeenCalledTimes(1);
	});

	test('TTL 切れ (4h 超): resolve が呼ばれる', async () => {
		const stale = makeRemoteNote({ lastFetchedAt: new Date(Date.now() - (TTL + 1000)) });
		await service.updateNoteIfStale(stale);
		expect(resolver.resolve).toHaveBeenCalledTimes(1);
	});

	test('成功時に refetchedCount が +1 され publishNoteStream が呼ばれる', async () => {
		const stale = makeRemoteNote({ lastFetchedAt: null });
		await service.updateNoteIfStale(stale);
		expect(notesRepository.increment).toHaveBeenCalledTimes(1);
		expect(notesRepository.increment).toHaveBeenCalledWith({ id: 'note1' }, 'refetchedCount', 1);
		expect(globalEventService.publishNoteStream).toHaveBeenCalledTimes(1);
		// publishNoteStream は MiNote オブジェクトを第1引数に取る (id 文字列ではない)。
		expect(globalEventService.publishNoteStream).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'note1', cw: null, text: 'updated' }),
			'updated',
			{ cw: null, text: 'updated' },
		);
	});

	test('失敗時 (resolver が throw): refetchedCount は加算されず publishNoteStream も呼ばれない', async () => {
		resolver.resolve.mockImplementationOnce(async () => { throw new Error('network'); });
		const stale = makeRemoteNote({ lastFetchedAt: null });
		const res = await service.updateNoteIfStale(stale);
		expect(notesRepository.increment).not.toHaveBeenCalled();
		expect(globalEventService.publishNoteStream).not.toHaveBeenCalled();
		// catch では元ノートを返す
		expect(res).toBe(stale);
	});

	test('per-host バジェット枯渇時は resolve せず現状ノート(再読込結果)を返す', async () => {
		// incr が予算上限 (30) を超える値を返すと consumeRefetchHostBudget は false
		redisClient.incr.mockImplementationOnce(async () => 31);
		const stale = makeRemoteNote({ lastFetchedAt: null });
		await service.updateNoteIfStale(stale);
		expect(resolver.resolve).not.toHaveBeenCalled();
		expect(notesRepository.increment).not.toHaveBeenCalled();
		expect(globalEventService.publishNoteStream).not.toHaveBeenCalled();
	});

	test('force 指定時は TTL 内でも resolve される', async () => {
		const fresh = makeRemoteNote({ lastFetchedAt: new Date() });
		await service.updateNoteIfStale(fresh, { force: true });
		expect(resolver.resolve).toHaveBeenCalledTimes(1);
	});
});
