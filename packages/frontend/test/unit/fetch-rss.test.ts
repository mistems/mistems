/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test, vi } from 'vitest';
import { fetchRss, getRssFetchErrorText, getRssRefreshIntervalMs, isValidRssRefreshIntervalMin, RSS_DEFAULT_REFRESH_INTERVAL_MIN, RSS_MIN_REFRESH_INTERVAL_MIN } from '@/utility/fetch-rss.js';

describe('getRssRefreshIntervalMs', () => {
	test('間隔は分で受け取り、ミリ秒で返す', () => {
		assert.strictEqual(getRssRefreshIntervalMs(120), 120 * 60 * 1000);
	});

	test('下限より短い間隔は下限 (45 分) にする', () => {
		assert.strictEqual(getRssRefreshIntervalMs(1), RSS_MIN_REFRESH_INTERVAL_MIN * 60 * 1000);
		assert.strictEqual(getRssRefreshIntervalMs(1), 45 * 60 * 1000);
	});

	test('数でない値・0 以下は既定値 (180 分) にする', () => {
		assert.strictEqual(getRssRefreshIntervalMs(Number.NaN), RSS_DEFAULT_REFRESH_INTERVAL_MIN * 60 * 1000);
		assert.strictEqual(getRssRefreshIntervalMs(0), 180 * 60 * 1000);
		assert.strictEqual(getRssRefreshIntervalMs(-1), 180 * 60 * 1000);
	});

	test('ステータスバーに保存されている秒の値 (これまでの既定値の 120 秒など) は、分に直すと下限になる', () => {
		assert.strictEqual(getRssRefreshIntervalMs(120 / 60), 45 * 60 * 1000);
	});
});

describe('isValidRssRefreshIntervalMin', () => {
	test('45〜1,440 分の数は保存してよい', () => {
		assert.isTrue(isValidRssRefreshIntervalMin(45));
		assert.isTrue(isValidRssRefreshIntervalMin(180));
		assert.isTrue(isValidRssRefreshIntervalMin(1440));
	});

	test('範囲の外の値・小数・数でない値は保存しない', () => {
		assert.isFalse(isValidRssRefreshIntervalMin(44));
		assert.isFalse(isValidRssRefreshIntervalMin(1441));
		assert.isFalse(isValidRssRefreshIntervalMin(45.5));
		assert.isFalse(isValidRssRefreshIntervalMin(Number.NaN));
		assert.isFalse(isValidRssRefreshIntervalMin(''));
		assert.isFalse(isValidRssRefreshIntervalMin(null));
	});
});

describe('fetchRss', () => {
	const fetchMock = vi.mocked(window.fetch);

	afterEach(() => {
		fetchMock.mockReset();
	});

	const respond = (status: number, body: unknown) => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
	};

	test('フィードの項目のうち、http・https のリンクを持つものだけを返す', async () => {
		respond(200, { items: [
			{ title: 'a', link: 'https://example.com/a' },
			{ title: 'b', link: 'javascript:alert(1)' },
			{ title: 'c' },
		] });
		const result = await fetchRss('https://example.com/feed.xml');
		assert.deepStrictEqual(result.items?.map(i => i.title), ['a']);
		assert.isUndefined(result.error);
		const requested = new URL(String(fetchMock.mock.calls[0][0]));
		assert.strictEqual(requested.pathname, '/api/fetch-rss');
		assert.strictEqual(requested.searchParams.get('url'), 'https://example.com/feed.xml');
	});

	test.each([
		['INVALID_URL', 400, 'invalidUrl'],
		['FETCH_RSS_FAILED', 422, 'failed'],
		['FETCH_RSS_RECENTLY_FAILED', 422, 'recentlyFailed'],
		['FETCH_RSS_UNAVAILABLE', 503, 'unavailable'],
		['SOMETHING_ELSE', 500, 'unknown'],
	] as const)('サーバーが %s を返したら、理由 %s を返す', async (code, status, error) => {
		respond(status, { error: { code } });
		const result = await fetchRss('https://example.com/feed.xml');
		assert.isUndefined(result.items);
		assert.strictEqual(result.error, error);
	});

	test('通信に失敗したら unknown を返す', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('network error'));
		assert.strictEqual((await fetchRss('https://example.com/feed.xml')).error, 'unknown');
	});

	test('フィードのタイトルも返す', async () => {
		respond(200, { title: 'Example', items: [{ title: 'a', link: 'https://example.com/a' }] });
		assert.strictEqual((await fetchRss('https://example.com/feed.xml')).title, 'Example');
	});

	test.each(['', 'example.com/feed.xml', 'https://', 'ftp://example.com/feed.xml'])('URL でないもの (%s) は、サーバーに問い合わせずに invalidUrl を返す', async (url) => {
		assert.strictEqual((await fetchRss(url)).error, 'invalidUrl');
		assert.strictEqual(fetchMock.mock.calls.length, 0);
	});

	test('items のない応答は failed を返す', async () => {
		respond(200, { title: 'not a feed' });
		assert.strictEqual((await fetchRss('https://example.com/feed.xml')).error, 'failed');
	});

	test('理由ごとに、画面に出す文がある', () => {
		for (const error of ['invalidUrl', 'failed', 'recentlyFailed', 'unavailable', 'unknown'] as const) {
			assert.isNotEmpty(getRssFetchErrorText(error));
		}
	});
});
