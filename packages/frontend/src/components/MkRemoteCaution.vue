<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root"><i class="ti ti-alert-triangle" style="margin-right: 8px;"></i>{{ i18n.ts.remoteUserCaution }}<a v-if="href" :class="$style.link" :href="href" rel="nofollow noopener" target="_blank">{{ i18n.ts.showOnRemote }}</a><template v-if="refetchable"><a v-if="canRefetchNow" :class="$style.link" href="#" @click.prevent="emit('refetch')">{{ i18n.ts.orRefetch }}</a><span v-else :class="$style.cooldown">{{ i18n.tsx.refetchAvailableIn({ time: i18n.tsx._timeIn.hours({ n: remainingHours }) }) }}</span><span v-if="refetchedCount" :class="$style.count">{{ i18n.tsx.refetchedNTimes({ n: refetchedCount }) }}</span></template></div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	href?: string;
	refetchable?: boolean;
	nextRefetchAt?: number | null;
	refetchedCount?: number;
}>();

const emit = defineEmits<{
	(ev: 'refetch'): void;
}>();

const canRefetchNow = computed(() => props.nextRefetchAt == null || Date.now() >= props.nextRefetchAt);
// MkTime と異なりリアルタイム更新はしない。時間単位で丸める。
const remainingHours = computed(() => Math.max(1, Math.round(((props.nextRefetchAt ?? 0) - Date.now()) / (1000 * 60 * 60))));
</script>

<style lang="scss" module>
.root {
	font-size: 0.8em;
	padding: 16px;
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.link {
	margin-left: 4px;
	color: var(--MI_THEME-accent);
}

.cooldown {
	margin-left: 4px;
	opacity: 0.7;
}

.count {
	margin-left: 4px;
	opacity: 0.7;
}
</style>
