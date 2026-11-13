<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkInput v-model="title">
		<template #label>{{ i18n.ts._pages.title }}</template>
	</MkInput>

	<MkInput v-model="summary">
		<template #label>{{ i18n.ts._pages.summary }}</template>
	</MkInput>

	<MkInput v-model="name">
		<template #prefix>{{ url }}/@{{ author?.username ?? '???' }}/pages/</template>
		<template #label>{{ i18n.ts._pages.url }}</template>
	</MkInput>

	<MkSwitch v-model="alignCenter">{{ i18n.ts._pages.alignCenter }}</MkSwitch>

	<MkSelect v-model="font" :items="fontItems">
		<template #label>{{ i18n.ts._pages.font }}</template>
	</MkSelect>

	<MkSwitch v-model="hideTitleWhenPinned">{{ i18n.ts._pages.hideTitleWhenPinned }}</MkSwitch>

	<div class="eyeCatch">
		<MkButton v-if="eyeCatchingImageId == null && !readonly" @click="setEyeCatchingImage"><i class="ti ti-plus"></i> {{ i18n.ts._pages.eyeCatchingImageSet }}</MkButton>
		<div v-else-if="eyeCatchingImage">
			<img :src="eyeCatchingImage.url" :alt="eyeCatchingImage.name" style="max-width: 100%;"/>
			<MkButton v-if="!readonly" @click="removeEyeCatchingImage()"><i class="ti ti-trash"></i> {{ i18n.ts._pages.eyeCatchingImageRemove }}</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import { url } from '@@/js/config.js';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import { i18n } from '@/i18n.js';
import { selectFile } from '@/utility/drive.js';
import { pageEditorInjectionKey } from '@/pages/page-editor/common.js';

const {
	readonly,
	title,
	summary,
	name,
	font,
	alignCenter,
	hideTitleWhenPinned,
	eyeCatchingImageId,
	eyeCatchingImage,
	author,
} = inject(pageEditorInjectionKey)!;

const fontItems = [
	{ label: i18n.ts._pages.fontSansSerif, value: 'sans-serif' },
	{ label: i18n.ts._pages.fontSerif, value: 'serif' },
];

function setEyeCatchingImage(ev: PointerEvent) {
	selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	}).then(file => {
		eyeCatchingImageId.value = file.id;
	});
}

function removeEyeCatchingImage() {
	eyeCatchingImageId.value = null;
}
</script>
