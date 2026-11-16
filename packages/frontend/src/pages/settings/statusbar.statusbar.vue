<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkSelect v-model="statusbar.type" :items="statusbarTypeDef">
		<template #label>{{ i18n.ts.type }}</template>
	</MkSelect>

	<MkInput v-model="statusbar.name" manualSave>
		<template #label>{{ i18n.ts.label }}</template>
	</MkInput>

	<MkSwitch v-model="statusbar.black">
		<template #label>Black</template>
	</MkSwitch>

	<MkRadios
		v-model="statusbar.size"
		:options="[
			{ value: 'verySmall', label: i18n.ts.small + '+' },
			{ value: 'small', label: i18n.ts.small },
			{ value: 'medium', label: i18n.ts.medium },
			{ value: 'large', label: i18n.ts.large },
			{ value: 'veryLarge', label: i18n.ts.large + '+' },
		]"
	>
		<template #label>{{ i18n.ts.size }}</template>
	</MkRadios>

	<template v-if="statusbar.type === 'rss'">
		<div class="_gaps_s">
			<MkInput v-model="rssUrlDraft" type="url">
				<template #label>URL</template>
				<template #caption>{{ i18n.ts._rssPreview.checkBeforeSave }}</template>
			</MkInput>
			<MkRssFeedPreview :url="rssPreviewUrl"/>
			<div v-if="rssUrlDraft !== statusbar.props.url" class="_buttons">
				<MkButton primary @click="saveRssUrl"><i class="ti ti-check"></i> {{ i18n.ts.save }}</MkButton>
				<MkButton @click="rssUrlDraft = statusbar.props.url ?? ''">{{ i18n.ts.cancel }}</MkButton>
			</div>
		</div>
		<MkSwitch v-model="statusbar.props.shuffle">
			<template #label>{{ i18n.ts.shuffle }}</template>
		</MkSwitch>
		<MkInput v-model="rssRefreshIntervalMinDraft" type="number" :min="RSS_MIN_REFRESH_INTERVAL_MIN" :max="RSS_MAX_REFRESH_INTERVAL_MIN" :step="1">
			<template #label>{{ i18n.ts._widgetOptions._rss.refreshIntervalMin }}</template>
			<template #suffix>{{ i18n.ts._time.minute }}</template>
			<template #caption><span :class="{ [$style.invalidCaption]: !isValidRssRefreshIntervalMin(rssRefreshIntervalMinDraft) }">{{ i18n.tsx._widgetOptions._rss.refreshIntervalMinDescription({ min: RSS_MIN_REFRESH_INTERVAL_MIN, max: RSS_MAX_REFRESH_INTERVAL_MIN }) }}</span></template>
		</MkInput>
		<MkRange v-model="statusbar.props.marqueeDuration" :min="5" :max="150" :step="1">
			<template #label>{{ i18n.ts.speed }}</template>
			<template #caption>{{ i18n.ts.fast }} &lt;-&gt; {{ i18n.ts.slow }}</template>
		</MkRange>
		<MkSwitch v-model="statusbar.props.marqueeReverse">
			<template #label>{{ i18n.ts.reverse }}</template>
		</MkSwitch>
	</template>
	<template v-else-if="statusbar.type === 'federation'">
		<MkInput v-model="statusbar.props.refreshIntervalSec" manualSave type="number" :min="1">
			<template #label>{{ i18n.ts.refreshInterval }}</template>
		</MkInput>
		<MkRange v-model="statusbar.props.marqueeDuration" :min="5" :max="150" :step="1">
			<template #label>{{ i18n.ts.speed }}</template>
			<template #caption>{{ i18n.ts.fast }} &lt;-&gt; {{ i18n.ts.slow }}</template>
		</MkRange>
		<MkSwitch v-model="statusbar.props.marqueeReverse">
			<template #label>{{ i18n.ts.reverse }}</template>
		</MkSwitch>
		<MkSwitch v-model="statusbar.props.colored">
			<template #label>{{ i18n.ts.colored }}</template>
		</MkSwitch>
	</template>
	<template v-else-if="statusbar.type === 'userList' && userLists != null">
		<MkSelect v-model="statusbar.props.userListId" :items="userListsDef">
			<template #label>{{ i18n.ts.userList }}</template>
		</MkSelect>
		<MkInput v-model="statusbar.props.refreshIntervalSec" manualSave type="number">
			<template #label>{{ i18n.ts.refreshInterval }}</template>
		</MkInput>
		<MkRange v-model="statusbar.props.marqueeDuration" :min="5" :max="150" :step="1">
			<template #label>{{ i18n.ts.speed }}</template>
			<template #caption>{{ i18n.ts.fast }} &lt;-&gt; {{ i18n.ts.slow }}</template>
		</MkRange>
		<MkSwitch v-model="statusbar.props.marqueeReverse">
			<template #label>{{ i18n.ts.reverse }}</template>
		</MkSwitch>
	</template>

	<div class="_buttons">
		<MkButton danger @click="del">{{ i18n.ts.remove }}</MkButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { reactive, computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { debounce } from 'throttle-debounce';
import MkSelect from '@/components/MkSelect.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkButton from '@/components/MkButton.vue';
import MkRange from '@/components/MkRange.vue';
import MkRssFeedPreview from '@/components/MkRssFeedPreview.vue';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { deepClone } from '@/utility/clone.js';
import { isValidRssRefreshIntervalMin, RSS_DEFAULT_REFRESH_INTERVAL_MIN, RSS_MAX_REFRESH_INTERVAL_MIN, RSS_MIN_REFRESH_INTERVAL_MIN } from '@/utility/fetch-rss.js';
import { prefer } from '@/preferences.js';
import type { MkSelectItem } from '@/components/MkSelect.vue';
import type { StatusbarStore } from '@/preferences/def.js';

const props = defineProps<{
	_id: string;
	userLists: Misskey.entities.UserList[] | null;
}>();

const statusbar = reactive<StatusbarStore>(deepClone(prefer.s.statusbars.find(x => x.id === props._id)!));

const statusbarTypeDef = computed(() => {
	const items = [
		{ label: 'RSS', value: 'rss' },
	] satisfies MkSelectItem[];
	if (instance.federation !== 'none') {
		items.push({ label: 'Federation', value: 'federation' });
	}
	if (props.userLists != null) {
		items.push({ label: i18n.ts.userList, value: 'userList' });
	}
	return items;
});

const userListsDef = computed(() => {
	return (props.userLists ?? []).map(x => ({ label: x.name, value: x.id })) satisfies MkSelectItem[];
});

// URL は、プレビューで確かめてから保存する
const rssUrlDraft = ref<string>(statusbar.props.url ?? '');
watch(() => statusbar.props.url, (url) => {
	rssUrlDraft.value = url ?? '';
});

// 入力の途中で取りに行かないよう、プレビューは入力が止まってから切り替える (保存するのは入力欄の今の値)
const rssPreviewUrl = ref<string>(rssUrlDraft.value);
const updateRssPreviewUrl = debounce(1000, (url: string) => {
	rssPreviewUrl.value = url;
});
watch(rssUrlDraft, (url) => {
	updateRssPreviewUrl(url);
});

function saveRssUrl() {
	statusbar.props.url = rssUrlDraft.value;
}

// ステータスバーの設定は、ほかの種類と共通で秒で保存するので、RSS の設定画面だけ分に直して見せる
function getSavedRssRefreshIntervalMin(): number {
	return Math.max(RSS_MIN_REFRESH_INTERVAL_MIN, Math.round((statusbar.props.refreshIntervalSec ?? RSS_DEFAULT_REFRESH_INTERVAL_MIN * 60) / 60));
}

// 範囲の外の値や数でない値は保存しない (入力欄には残し、注意書きを赤くする)
const rssRefreshIntervalMinDraft = ref<number>(getSavedRssRefreshIntervalMin());
watch(rssRefreshIntervalMinDraft, (min) => {
	if (!isValidRssRefreshIntervalMin(min)) return;
	statusbar.props.refreshIntervalSec = min * 60;
});
watch(() => statusbar.props.refreshIntervalSec, () => {
	rssRefreshIntervalMinDraft.value = getSavedRssRefreshIntervalMin();
});

watch(() => statusbar.type, () => {
	if (statusbar.type === 'rss') {
		statusbar.name = 'NEWS';
		statusbar.props.url = 'http://feeds.afpbb.com/rss/afpbb/afpbbnews';
		statusbar.props.shuffle = true;
		statusbar.props.refreshIntervalSec = RSS_DEFAULT_REFRESH_INTERVAL_MIN * 60;
		statusbar.props.display = 'marquee';
		statusbar.props.marqueeDuration = 100;
		statusbar.props.marqueeReverse = false;
	} else if (statusbar.type === 'federation') {
		statusbar.name = 'FEDERATION';
		statusbar.props.refreshIntervalSec = 120;
		statusbar.props.display = 'marquee';
		statusbar.props.marqueeDuration = 100;
		statusbar.props.marqueeReverse = false;
		statusbar.props.colored = false;
	} else if (statusbar.type === 'userList') {
		statusbar.name = 'LIST TL';
		statusbar.props.refreshIntervalSec = 120;
		statusbar.props.display = 'marquee';
		statusbar.props.marqueeDuration = 100;
		statusbar.props.marqueeReverse = false;
	}
});

watch(statusbar, save);

async function save() {
	const i = prefer.s.statusbars.findIndex(x => x.id === props._id);
	const statusbars = deepClone(prefer.s.statusbars);
	statusbars[i] = deepClone(statusbar);
	prefer.commit('statusbars', statusbars);
}

function del() {
	prefer.commit('statusbars', prefer.s.statusbars.filter(x => x.id !== props._id));
}
</script>

<style lang="scss" module>
.invalidCaption {
	color: var(--MI_THEME-error);
}
</style>
