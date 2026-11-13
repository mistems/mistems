<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" class="_panel">
	<div :class="$style.header">
		<i class="ti ti-rss"></i>
		<span :class="$style.title">{{ title ?? i18n.ts.preview }}</span>
		<span v-if="!fetching && items.length > 0" :class="$style.count">{{ i18n.tsx._rssPreview.itemsCount({ n: items.length }) }}</span>
	</div>
	<div :class="$style.body">
		<MkRssFeedItems :items="items.slice(0, maxEntries)" :fetching="fetching" :error="error"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import MkRssFeedItems from '@/components/MkRssFeedItems.vue';
import { i18n } from '@/i18n.js';
import { useRssFeed } from '@/utility/use-rss-feed.js';

// 設定画面で、保存する前に URL から何が取れるかを見せる
const props = withDefaults(defineProps<{
	url: string;
	maxEntries?: number;
}>(), {
	maxEntries: 10,
});

const { items, title, fetching, error } = useRssFeed({
	url: () => props.url,
});
</script>

<style lang="scss" module>
.root {
	overflow: clip;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
}

.header {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 16px;
	font-size: 0.9em;
	font-weight: bold;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.title {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
}

.count {
	flex-shrink: 0;
	font-weight: normal;
	opacity: 0.7;
}

.body {
	max-height: 300px;
	overflow: auto;
}
</style>
