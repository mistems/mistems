/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, beforeEach, describe, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import { directives } from '@/directives/index.js';
import { components } from '@/components/index.js';
import MkChatHistories from '@/components/MkChatHistories.vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const mocks = vi.hoisted(() => ({
	listeners: new Map<string, () => void>(),
	dispose: vi.fn(),
	realtimeMode: true,
}));

vi.mock('@/i.js', async (importOriginal) => {
	const me = { id: 'me', policies: {} };
	return {
		...await importOriginal<typeof import('@/i.js')>(),
		ensureSignin: () => me,
		$i: me,
	};
});

vi.mock('@/utility/misskey-api.js', () => ({
	misskeyApi: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/store.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/store.js')>();
	return {
		...original,
		store: new Proxy(original.store, {
			get(target, key, receiver) {
				if (key === 's') {
					return new Proxy(target.s, {
						get: (s, k) => k === 'realtimeMode' ? mocks.realtimeMode : Reflect.get(s, k),
					});
				}
				return Reflect.get(target, key, receiver);
			},
		}),
	};
});

vi.mock('@/stream.js', () => ({
	useStream: () => ({
		useChannel: () => ({
			on: (type: string, listener: () => void) => {
				mocks.listeners.set(type, listener);
			},
			dispose: mocks.dispose,
		}),
	}),
}));

const flush = async () => {
	await nextTick();
	await vi.advanceTimersByTimeAsync(0);
};

describe('MkChatHistories', () => {
	const api = vi.mocked(misskeyApi);

	beforeEach(() => {
		vi.useFakeTimers();
		api.mockClear();
		mocks.listeners.clear();
		mocks.dispose.mockClear();
		mocks.realtimeMode = true;
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	const mount = () => render(MkChatHistories, { global: { directives, components } });

	test('表示したときに 1 回 (個人とルームで 2 リクエスト) 取得する', async () => {
		mount();
		await flush();
		assert.strictEqual(api.mock.calls.length, 2);
	});

	test('定期取得は 60 秒ごとで、10 秒では取得しない', async () => {
		mount();
		await flush();
		api.mockClear();

		await vi.advanceTimersByTimeAsync(1000 * 10);
		assert.strictEqual(api.mock.calls.length, 0);

		await vi.advanceTimersByTimeAsync(1000 * 50);
		assert.strictEqual(api.mock.calls.length, 2);
	});

	test('newChatMessage を受けたら取り直す', async () => {
		mount();
		await flush();
		api.mockClear();

		const listener = mocks.listeners.get('newChatMessage');
		assert.exists(listener);
		listener!();
		await flush();
		assert.strictEqual(api.mock.calls.length, 2);
	});

	test('外したら main ストリームの接続を閉じる', async () => {
		const result = mount();
		await flush();
		result.unmount();
		assert.strictEqual(mocks.dispose.mock.calls.length, 1);
	});

	test('リアルタイムモードが無効なら main ストリームにつながず、10 秒ごとに取得する', async () => {
		mocks.realtimeMode = false;
		mount();
		await flush();
		assert.strictEqual(mocks.listeners.size, 0);
		api.mockClear();

		await vi.advanceTimersByTimeAsync(1000 * 10);
		assert.strictEqual(api.mock.calls.length, 2);
	});

	test('取得中に newChatMessage を受けたら、取得が終わったあとにもう一度取得する', async () => {
		mount();
		await flush();
		api.mockClear();

		let resolveFirst: (() => void) | undefined;
		api.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = () => resolve([]); }));
		const listener = mocks.listeners.get('newChatMessage')!;
		listener();
		listener();
		await flush();
		assert.strictEqual(api.mock.calls.length, 2);

		resolveFirst!();
		await flush();
		await flush();
		assert.strictEqual(api.mock.calls.length, 4);
	});
});
