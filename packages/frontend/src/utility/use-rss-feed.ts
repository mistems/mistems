/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onScopeDispose, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { createVisibilityAwareInterval } from '@@/js/interval.js';
import type { Ref } from 'vue';
import type { RssFetchError } from '@/utility/fetch-rss.js';
import { fetchRss, getRssRefreshIntervalMs } from '@/utility/fetch-rss.js';

type RssItem = Misskey.entities.FetchRssResponse['items'][number];

/**
 * RSS のウィジェット・ステータスバー・設定画面のプレビューで、フィードを取って持っておく。
 * URL が変わったら、前の URL の項目を捨てて取り直す。
 * refreshIntervalMin を渡したときは、その間隔 (分) で取り直す。間隔が変わったら作り直す
 */
export function useRssFeed(options: {
	url: () => string;
	refreshIntervalMin?: () => number;
}): {
	items: Ref<RssItem[]>;
	title: Ref<string | null>;
	fetching: Ref<boolean>;
	error: Ref<RssFetchError | null>;
} {
	const items = ref<RssItem[]>([]);
	const title = ref<string | null>(null);
	const fetching = ref(true);
	// 取れなかったときは、前に取れた項目があればそれを出したままにする
	const error = ref<RssFetchError | null>(null);

	// 取得中に URL が変わったら、古い応答は捨てる
	let generation = 0;

	const tick = async () => {
		const current = ++generation;
		const result = await fetchRss(options.url());
		if (current !== generation) return;
		if (result.items != null) {
			items.value = result.items;
			title.value = result.title ?? null;
		}
		error.value = result.error ?? null;
		fetching.value = false;
	};

	watch(options.url, () => {
		// 前の URL で取れた項目は出さない
		items.value = [];
		title.value = null;
		error.value = null;
		fetching.value = true;
		tick();
	});

	const getIntervalMin = options.refreshIntervalMin;
	if (getIntervalMin != null) {
		// 間隔を変えたときに作り直せるよう、useInterval ではなく直接使う
		let intervalClear: (() => void) | null = null;
		// 入力途中の値などで、実際の間隔が変わらないときは作り直さない
		watch(() => getRssRefreshIntervalMs(getIntervalMin()), (intervalMs) => {
			intervalClear?.();
			intervalClear = createVisibilityAwareInterval(tick, intervalMs, {
				immediate: true,
			});
		}, { immediate: true });
		onScopeDispose(() => {
			intervalClear?.();
		});
	} else {
		tick();
	}

	onScopeDispose(() => {
		// 破棄したあとに届いた応答は捨てる
		generation++;
	});

	return { items, title, fetching, error };
}
