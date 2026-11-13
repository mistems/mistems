<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XPie :class="$style.pie" :value="usage"/>
	<div :class="$style.body">
		<p><i class="ti ti-plug"></i>Connections</p>
		<p>Active: {{ stats?.connActive ?? '-' }}</p>
		<p>Max: {{ stats?.connMax ?? '-' }}</p>
		<p>Cache hit: {{ cacheHitP }}</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import XPie from './pie.vue';

const props = defineProps<{
	stats: Misskey.entities.DbServerStats | null;
}>();

const usage = computed(() => {
	const s = props.stats;
	if (!s || s.connActive == null || s.connMax == null || s.connMax === 0) return 0;
	return s.connActive / s.connMax;
});

const cacheHitP = computed(() => {
	const r = props.stats?.cacheHitRatio;
	return r == null ? '-' : `${(r * 100).toFixed(1)}%`;
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	padding: 16px;
}

.pie {
	height: 82px;
	flex-shrink: 0;
	margin-right: 16px;
}

.body {
	flex: 1;

	> p {
		margin: 0;
		font-size: 0.8em;

		&:first-child {
			font-weight: bold;
			margin-bottom: 4px;

			> i {
				margin-right: 4px;
			}
		}
	}
}
</style>
