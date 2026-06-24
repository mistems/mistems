<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 800px;">
	<MkSwitch v-model="enableFavstar" style="margin-bottom: var(--MI-margin);">ふぁぼったー</MkSwitch>
	<div v-if="enableFavstar" :class="$style.favstarColors">
		<MkRadios v-model="favstarLightAo" :options="lightAoOptions">
			<template #label>ライトモードの青ふぁぼ</template>
		</MkRadios>
		<MkRadios v-model="favstarLightAka" :options="lightAkaOptions">
			<template #label>ライトモードの赤ふぁぼ</template>
		</MkRadios>
		<MkRadios v-model="favstarDarkAo" :options="darkAoOptions">
			<template #label>ダークモードの青ふぁぼ</template>
		</MkRadios>
		<MkRadios v-model="favstarDarkAka" :options="darkAkaOptions">
			<template #label>ダークモードの赤ふぁぼ</template>
		</MkRadios>
	</div>
	<MkTab
		v-model="tab"
		:tabs="[
			{ key: 'notes', label: i18n.ts.notes },
			{ key: 'polls', label: i18n.ts.poll },
		]"
		style="margin-bottom: var(--MI-margin);"
	>
	</MkTab>
	<MkNotesTimeline v-if="tab === 'notes'" :featured="true" :paginator="paginatorForNotes"/>
	<MkNotesTimeline v-else-if="tab === 'polls'" :featured="true" :paginator="paginatorForPolls"/>
</div>
</template>

<script lang="ts" setup>
import { markRaw, ref } from 'vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkTab from '@/components/MkTab.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkRadios from '@/components/MkRadios.vue';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';
import { prefer } from '@/preferences.js';

const enableFavstar = prefer.model('enableFavstar');
const favstarLightAo = prefer.model('favstarLightAo');
const favstarLightAka = prefer.model('favstarLightAka');
const favstarDarkAo = prefer.model('favstarDarkAo');
const favstarDarkAka = prefer.model('favstarDarkAka');

const withSwatch = (entries: { value: string; label: string }[]) =>
	entries.map(e => ({ ...e, labelStyle: { color: e.value, fontWeight: 'bold' } }));

const lightAoOptions = withSwatch([
	{ value: '#44a4c1', label: '既定' },
	{ value: '#5db0da', label: 'Rainy' },
	{ value: '#008cff', label: 'Vivid' },
]);
const lightAkaOptions = withSwatch([
	{ value: '#f7796c', label: '既定' },
	{ value: '#dd2e44', label: 'Love' },
	{ value: '#db6072', label: 'Cherry' },
]);
const darkAoOptions = withSwatch([
	{ value: '#44a4c1', label: '既定' },
	{ value: '#47bfe8', label: 'Ice' },
	{ value: '#70c0e8', label: 'Future' },
]);
const darkAkaOptions = withSwatch([
	{ value: '#f7796c', label: '既定' },
	{ value: '#ff5975', label: 'Cherry' },
	{ value: '#ff6652', label: 'Astro' },
]);

const paginatorForNotes = markRaw(new Paginator('notes/featured', {
	limit: 10,
}));

const paginatorForPolls = markRaw(new Paginator('notes/polls/recommendation', {
	limit: 10,
	offsetMode: true,
	params: {
		excludeChannels: true,
	},
}));

const tab = ref<'notes' | 'polls'>('notes');
</script>

<style lang="scss" module>
.favstarColors {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-bottom: var(--MI-margin);
}
</style>
