/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/vue';
import { nextTick } from 'vue';
import './init.js';
import { components } from '@/components/index.js';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';

// 描画にのみ影響するディレクティブは no-op で十分
const noopDirective = { mounted: () => {}, updated: () => {}, beforeUnmount: () => {} };
const stubDirectives = new Proxy({} as Record<string, typeof noopDirective>, {
	get: () => noopDirective,
});

const misskeyApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/utility/misskey-api.js', () => ({
	misskeyApi: misskeyApiMock,
	misskeyApiGet: misskeyApiMock,
	pendingApiRequestsCount: { value: 0 },
}));

// ストリームのイベントハンドラを捕捉し、テストから _disconnected_ / _connected_ / チャンネルの note を発火できるようにする
const streamMock = vi.hoisted(() => {
	type Handler = (...args: unknown[]) => void;
	const streamHandlers = new Map<string, Set<Handler>>();
	const channelHandlers = new Map<string, Set<Handler>>();
	const add = (map: Map<string, Set<Handler>>, ev: string, fn: Handler) => {
		if (!map.has(ev)) map.set(ev, new Set());
		map.get(ev)!.add(fn);
	};
	return {
		stream: {
			on: (ev: string, fn: Handler) => add(streamHandlers, ev, fn),
			off: (ev: string, fn: Handler) => streamHandlers.get(ev)?.delete(fn),
			useChannel: () => ({
				on: (ev: string, fn: Handler) => add(channelHandlers, ev, fn),
				off: (ev: string, fn: Handler) => channelHandlers.get(ev)?.delete(fn),
				send: () => {},
				dispose: () => {},
			}),
		},
		emit(ev: string) {
			for (const fn of streamHandlers.get(ev) ?? []) fn();
		},
		emitChannel(ev: string, payload: unknown) {
			for (const fn of channelHandlers.get(ev) ?? []) fn(payload);
		},
		reset() {
			streamHandlers.clear();
			channelHandlers.clear();
		},
	};
});

vi.mock('@/stream.js', () => ({
	useStream: () => streamMock.stream,
}));

vi.mock('@/store.js', () => ({
	store: {
		s: { realtimeMode: true },
		r: {},
	},
}));

vi.mock('@/i.js', () => ({
	$i: null,
	iAmModerator: false,
	iAmAdmin: false,
	notesCount: 0,
	ensureSignin: vi.fn(),
	incNotesCount: vi.fn(),
	updateAccount: vi.fn(),
	updateAccountPartial: vi.fn(),
	refreshAccount: vi.fn(),
	login: vi.fn(),
	signout: vi.fn(),
	signoutAndRemoveAccount: vi.fn(),
	signoutAndRemoveAccounts: vi.fn(),
	getAccounts: vi.fn(() => []),
	addAccount: vi.fn(),
	removeAccount: vi.fn(),
}));

vi.mock('@/instance.js', () => ({
	instance: { notesPerOneAd: 0 },
}));

// visibility をテストから操作できるよう、共有の ref を返す
vi.mock('@@/js/use-document-visibility.js', async () => {
	const { ref } = await import('vue');
	const visibility = ref<DocumentVisibilityState>('visible');
	return { useDocumentVisibility: () => visibility };
});

function note(id: string, createdAt: string) {
	return { id, createdAt, userId: 'u', user: { id: 'u', username: 'u', host: null }, text: id, visibility: 'public', reactions: {}, reactionEmojis: {}, renoteCount: 0, repliesCount: 0, reactionCount: 0, files: [], fileIds: [], emojis: {} };
}

// 初期表示 (同じ日)
const initialNotes = [
	note('n003', '2026-01-01T03:00:00.000Z'),
	note('n002', '2026-01-01T02:00:00.000Z'),
	note('n001', '2026-01-01T01:00:00.000Z'),
];

// 区間取得 (fetchRange) の応答。null なら失敗扱いでマーカーが残る
let fetchRangeResult: unknown[] | null = null;

// MkNote は描画コストが高いので、id だけ出すスタブに置き換える
const stubs = {
	MkNote: { props: ['note'], template: '<div :data-note-id="note.id"></div>' },
	MkAd: { template: '<div></div>' },
};

function renderTimeline() {
	misskeyApiMock.mockImplementation((_endpoint: string, params?: { sinceId?: string }) => {
		return Promise.resolve(params?.sinceId != null ? fetchRangeResult : initialNotes);
	});
	return render(MkStreamingNotesTimeline, {
		props: { src: 'home' },
		global: { components, directives: stubDirectives, stubs },
	});
}

function renderedIds(container: Element): string[] {
	return [...container.querySelectorAll<HTMLElement>('[data-note-id], [data-gap-id]')]
		.map(el => el.dataset.noteId ?? el.dataset.gapId!);
}

async function waitForInitialNotes(container: Element) {
	await waitFor(() => expect(container.querySelectorAll('[data-note-id]')).toHaveLength(3));
}

afterEach(() => {
	cleanup();
	streamMock.reset();
	misskeyApiMock.mockReset();
	fetchRangeResult = null;
	useDocumentVisibility().value = 'visible';
	vi.useRealTimers();
});

describe('MkStreamingNotesTimeline: 歯抜けマーカー', () => {
	test('WS 再接続でマーカーが先頭に立ち、先頭表示中なら切断直前の最新 id から自動補給する', async () => {
		const { container } = renderTimeline();
		await waitForInitialNotes(container);
		expect(container.querySelector('[data-gap-id]')).toBeNull();

		// 初回接続 (_connected_ のみ) ではマーカーを立てない
		streamMock.emit('_connected_');
		await nextTick();
		expect(container.querySelector('[data-gap-id]')).toBeNull();

		streamMock.emit('_disconnected_');
		streamMock.emit('_connected_');
		await nextTick();

		expect(renderedIds(container)).toEqual(['gap:0', 'n003', 'n002', 'n001']);
		// 補給中はスピナー表示になるので、常に付いている aria-label で文言を確認する
		expect(container.querySelector('[data-gap-id] button')?.getAttribute('aria-label')).toBe('間のノートを取得');
		// 切断直前の最新 id (n003) から現在までを取りに行く
		expect(misskeyApiMock).toHaveBeenLastCalledWith('notes/timeline', expect.objectContaining({ sinceId: 'n003', limit: 30 }));
		expect(misskeyApiMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('untilId');
	});

	test('再接続後に届いた最初のノートで上限が確定し、日付セパレータはマーカーを飛ばして判定される', async () => {
		const { container } = renderTimeline();
		await waitForInitialNotes(container);

		streamMock.emit('_disconnected_');
		streamMock.emit('_connected_');
		await nextTick();

		// 別の日のノートがストリームから届く → 先頭に挿入され、マーカーはその下 (n003 の直前) に残る
		streamMock.emitChannel('note', note('n004', '2026-01-02T00:00:00.000Z'));
		await nextTick();

		expect(renderedIds(container)).toEqual(['n004', 'gap:0', 'n003', 'n002', 'n001']);
		// セパレータは n004 (1/2) と n003 (1/1) の間に 1 つだけ。マーカー自身はセパレータ判定に参加しない
		expect(container.querySelectorAll('.ti-chevron-up')).toHaveLength(1);
	});

	test('5 分以上 hidden だった後の復帰でマーカーを立てる。短時間なら立てない', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
		const visibility = useDocumentVisibility();

		const { container } = renderTimeline();
		await waitForInitialNotes(container);

		// 1 分の離席 → 立てない
		visibility.value = 'hidden';
		await nextTick();
		vi.setSystemTime(new Date('2026-01-03T00:01:00.000Z'));
		visibility.value = 'visible';
		await nextTick();
		expect(container.querySelector('[data-gap-id]')).toBeNull();

		// 6 分の離席 → 立てる
		visibility.value = 'hidden';
		await nextTick();
		vi.setSystemTime(new Date('2026-01-03T00:07:00.000Z'));
		visibility.value = 'visible';
		await nextTick();
		expect(renderedIds(container)).toEqual(['gap:0', 'n003', 'n002', 'n001']);
	});

	test('自動補給で区間が埋まればマーカーは消える', async () => {
		fetchRangeResult = [];
		const { container } = renderTimeline();
		await waitForInitialNotes(container);

		streamMock.emit('_disconnected_');
		streamMock.emit('_connected_');
		await waitFor(() => expect(misskeyApiMock).toHaveBeenLastCalledWith('notes/timeline', expect.objectContaining({ sinceId: 'n003' })));
		// 空が返るので補給完了と同時にマーカーが消える
		await waitFor(() => expect(container.querySelector('[data-gap-id]')).toBeNull());
		expect(renderedIds(container)).toEqual(['n003', 'n002', 'n001']);
	});
});
