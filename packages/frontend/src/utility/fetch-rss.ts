/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { url as base } from '@@/js/config.js';
import { tryParseUrl } from '@@/js/url.js';
import { i18n } from '@/i18n.js';

/**
 * RSS を取り直す間隔の下限・上限・既定値 (分)。
 * RSS は頻繁に更新されるものではなく、取り直すたびにサーバーが相手のサイトへ取りに行くので、長めにとる
 */
export const RSS_MIN_REFRESH_INTERVAL_MIN = 45;
export const RSS_MAX_REFRESH_INTERVAL_MIN = 24 * 60;
export const RSS_DEFAULT_REFRESH_INTERVAL_MIN = 180;

/** 設定画面で入力された間隔 (分) が、保存してよい値か。分の整数で、下限から上限まで */
export function isValidRssRefreshIntervalMin(min: unknown): min is number {
	return typeof min === 'number' && Number.isInteger(min) && min >= RSS_MIN_REFRESH_INTERVAL_MIN && min <= RSS_MAX_REFRESH_INTERVAL_MIN;
}

/** 設定の間隔 (分) を、下限を守ったミリ秒にする */
export function getRssRefreshIntervalMs(min: number): number {
	const value = Number.isFinite(min) && min > 0 ? min : RSS_DEFAULT_REFRESH_INTERVAL_MIN;
	return Math.max(RSS_MIN_REFRESH_INTERVAL_MIN, value) * 60 * 1000;
}

type RssItem = Misskey.entities.FetchRssResponse['items'][number];

/**
 * 取れなかった理由。設定画面のプレビューで、閉じる前に URL が正しいかを確かめられるように分ける
 * - invalidUrl: URL の形式が正しくない (http・https 以外、認証情報を含むなど)
 * - failed: 取得か RSS としての解析に失敗した (RSS でないページ、サイトに接続できないなど)
 * - recentlyFailed: 少し前に取得に失敗した URL なので、サーバーが取りに行かなかった
 * - unavailable: サーバーが混み合っている
 * - unknown: 通信の失敗など、それ以外
 */
export type RssFetchError = 'invalidUrl' | 'failed' | 'recentlyFailed' | 'unavailable' | 'unknown';

export type RssFetchResult = { items: RssItem[]; title?: string; error?: undefined } | { items?: undefined; title?: undefined; error: RssFetchError };

const ERROR_CODES: Record<string, RssFetchError> = {
	INVALID_URL: 'invalidUrl',
	FETCH_RSS_FAILED: 'failed',
	FETCH_RSS_RECENTLY_FAILED: 'recentlyFailed',
	FETCH_RSS_UNAVAILABLE: 'unavailable',
};

/**
 * fetch-rss でフィードを取る。取れなかったときは、理由を返す。
 * 項目は、http・https のリンクを持つものだけを返す
 */
export async function fetchRss(feedUrl: string): Promise<RssFetchResult> {
	// 明らかに URL でないものは、サーバーに問い合わせずに断る (入力途中の URL でプレビューが問い合わせないように)
	const parsedFeedUrl = tryParseUrl(feedUrl);
	if (parsedFeedUrl == null || !['http:', 'https:'].includes(parsedFeedUrl.protocol)) return { error: 'invalidUrl' };

	const endpoint = new URL('/api/fetch-rss', base);
	endpoint.searchParams.set('url', feedUrl);

	let body: unknown;
	let ok: boolean;
	try {
		const res = await window.fetch(endpoint.toString());
		ok = res.ok;
		body = await res.json();
	} catch {
		return { error: 'unknown' };
	}

	if (!ok) {
		const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
		return { error: (typeof code === 'string' ? ERROR_CODES[code] : undefined) ?? 'unknown' };
	}

	const feed = body as Partial<Misskey.entities.FetchRssResponse> | null;
	if (feed == null || !Array.isArray(feed.items)) return { error: 'failed' };

	return {
		items: feed.items.filter((item) => {
			if (!item.link) return false;
			const itemUrl = tryParseUrl(item.link, base);
			return itemUrl != null && ['http:', 'https:'].includes(itemUrl.protocol);
		}),
		title: typeof feed.title === 'string' ? feed.title : undefined,
	};
}

/** 取れなかった理由を、画面に出す文にする */
export function getRssFetchErrorText(error: RssFetchError): string {
	return error === 'unknown' ? i18n.ts.somethingHappened : i18n.ts._rssFetchError[error];
}
