<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkLoading v-if="fetching"/>
<MkResult v-else-if="error != null && items.length === 0" type="error" :text="getRssFetchErrorText(error)"/>
<MkResult v-else-if="items.length === 0 && showEmpty" type="empty"/>
<div v-else :class="$style.feed">
	<a v-for="item in items" :key="item.link" :class="$style.item" :href="item.link" rel="nofollow noopener" target="_blank" :title="item.title">{{ item.title }}</a>
</div>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import type { RssFetchError } from '@/utility/fetch-rss.js';
import { getRssFetchErrorText } from '@/utility/fetch-rss.js';

// RSS ウィジェットと、ステータスバーの設定画面のプレビューで、取れた項目か取れなかった理由を出す
withDefaults(defineProps<{
	items: Misskey.entities.FetchRssResponse['items'];
	fetching: boolean;
	error: RssFetchError | null;
	showEmpty?: boolean;
}>(), {
	showEmpty: true,
});
</script>

<style lang="scss" module>
.feed {
	padding: 0;
	font-size: 0.9em;
}

.item {
	display: block;
	padding: 8px 16px;
	color: var(--MI_THEME-fg);
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;

	&:nth-child(even) {
		background: rgba(#000, 0.05);
	}
}
</style>
