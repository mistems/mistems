<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XPie :class="$style.pie" :value="usage"/>
	<div :class="$style.body">
		<p><i class="ti ti-database"></i>Disk</p>
		<p>Total: {{ stats?.diskTotal != null ? bytes(stats.diskTotal, 1) : '-' }}</p>
		<p>Free: {{ free != null ? bytes(free, 1) : '-' }}</p>
		<p>Used: {{ stats?.diskUsed != null ? bytes(stats.diskUsed, 1) : '-' }}</p>
		<p>DB size: {{ stats?.dbSize != null ? bytes(stats.dbSize, 1) : '-' }}</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import XPie from './pie.vue';
import bytes from '@/filters/bytes.js';

const props = defineProps<{
	stats: Misskey.entities.DbServerStats | null;
}>();

const usage = computed(() => {
	const s = props.stats;
	if (!s || s.diskUsed == null || s.diskTotal == null || s.diskTotal === 0) return 0;
	return s.diskUsed / s.diskTotal;
});

const free = computed(() => {
	const s = props.stats;
	if (!s || s.diskUsed == null || s.diskTotal == null) return null;
	return s.diskTotal - s.diskUsed;
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
