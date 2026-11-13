/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, beforeEach, describe, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { directives } from '@/directives/index.js';
import { components } from '@/components/index.js';
import MkMfm from '@/components/global/MkMfm.js';
import * as os from '@/os.js';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({
	me: null as null | { id: string; policies: Record<string, unknown>; mutedWords: (string | string[])[]; hardMutedWords: (string | string[])[] },
}));

vi.mock('@/i.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/i.js')>();
	return {
		...original,
		get $i() { return mocks.me; },
	};
});

vi.mock('@/os.js', () => ({
	contextMenu: vi.fn(),
	apiWithDialog: vi.fn(() => Promise.resolve()),
	pageWindow: vi.fn(),
	popup: vi.fn(),
}));

type ButtonItem = { text?: string; action?: () => unknown; type?: string };

describe('ハッシュタグの右クリックのメニューからミュートする', () => {
	const contextMenu = vi.mocked(os.contextMenu);
	const apiWithDialog = vi.mocked(os.apiWithDialog);

	beforeEach(() => {
		contextMenu.mockClear();
		apiWithDialog.mockClear();
		mocks.me = { id: 'me', policies: {}, mutedWords: [], hardMutedWords: [] };
	});

	afterEach(() => {
		cleanup();
	});

	const openMenu = async (text: string): Promise<ButtonItem[]> => {
		const result = render(MkMfm, { props: { text }, global: { directives, components } });
		const anchor = result.container.querySelector('a[href^="/tags/"]');
		assert.exists(anchor);
		await fireEvent.contextMenu(anchor!);
		assert.strictEqual(contextMenu.mock.calls.length, 1);
		return contextMenu.mock.calls[0][0] as MenuItem[] as ButtonItem[];
	};

	const MUTE = '/#misskey(?:[^\\p{L}\\p{N}_]|$)/iu';

	test('ワードミュートとハードワードミュートが出て、ハッシュタグの正規表現で登録する', async () => {
		const items = await openMenu('こんにちは #misskey');
		const wordMute = items.find(i => i.text === i18n.ts.wordMute);
		const hardMute = items.find(i => i.text === i18n.ts.hardWordMute);
		assert.exists(wordMute);
		assert.exists(hardMute);

		await wordMute!.action!();
		assert.deepStrictEqual(apiWithDialog.mock.calls[0], ['i/update', { mutedWords: [MUTE] }]);

		await hardMute!.action!();
		assert.deepStrictEqual(apiWithDialog.mock.calls[1], ['i/update', { hardMutedWords: [MUTE] }]);
	});

	test('登録した正規表現は、そのハッシュタグだけに当たる (大文字・小文字は区別しない)', () => {
		const parts = MUTE.match(/^\/(.+)\/(.*)$/)!;
		const re = new RegExp(parts[1], parts[2]);
		assert.isTrue(re.test('こんにちは #misskey'));
		assert.isTrue(re.test('#Misskey!'));
		assert.isTrue(re.test('#misskey すごい'));
		assert.isFalse(re.test('#misskeyio'));
		assert.isFalse(re.test('#misskey_dev'));
		assert.isFalse(re.test('misskey'));
	});

	test('タグの中の正規表現の記号は、文字として扱う', async () => {
		const items = await openMenu('#a.b');
		await items.find(i => i.text === i18n.ts.wordMute)!.action!();
		const word = (apiWithDialog.mock.calls[0][1] as { mutedWords: string[] }).mutedWords[0];
		const parts = word.match(/^\/(.+)\/(.*)$/)!;
		const re = new RegExp(parts[1], parts[2]);
		assert.isTrue(re.test('#a.b'));
		assert.isFalse(re.test('#axb'));
	});

	test('すでにミュートしている種類は出さない', async () => {
		mocks.me!.mutedWords = [MUTE];
		const items = await openMenu('#misskey');
		assert.notExists(items.find(i => i.text === i18n.ts.wordMute));
		assert.exists(items.find(i => i.text === i18n.ts.hardWordMute));
	});

	test('サインインしていなければ、ミュートの項目は出さない', async () => {
		mocks.me = null;
		const items = await openMenu('#misskey');
		assert.notExists(items.find(i => i.text === i18n.ts.wordMute));
		assert.notExists(items.find(i => i.text === '#misskey'));
		// 足す項目がないときは、区切り線も足さない
		assert.strictEqual(items.filter(i => i.type === 'divider').length, 1);
	});

	test('ふつうのリンクのメニューは変わらない', async () => {
		const items = await openMenu('#misskey');
		assert.exists(items.find(i => i.text === i18n.ts.copyLink));
		assert.exists(items.find(i => i.text === i18n.ts.openInWindow));
	});
});
