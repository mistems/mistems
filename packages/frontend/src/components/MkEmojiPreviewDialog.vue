<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="800"
	:height="440"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-mood-smile"></i> {{ i18n.ts._emojiPreview.title }}</template>

	<div :class="$style.root">
		<MkEmojiPreviewNote
			v-for="item in items"
			:key="item.key"
			:emojiUrl="url"
			:emojiName="emojiName"
			:theme="item.theme"
			:label="item.label"
			:user="user"
		/>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import defaultLightTheme from '@@/themes/l-light.json5';
import defaultDarkTheme from '@@/themes/d-green-lime.json5';
import type { Theme } from '@@/js/theme.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkEmojiPreviewNote from '@/components/MkEmojiPreviewNote.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	/** 絵文字として表示する画像の URL */
	url: string;
	/** 画像のファイル名。絵文字の名前の代わりに使う */
	name: string;
	user?: Misskey.entities.User | null;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const emojiName = computed(() => props.name.replace(/\.[^.]+$/, '').replace(/[^\w]/g, '_') || 'emoji');

const items = computed<{ key: string; theme: Theme; label: string; }[]>(() => [{
	key: 'lightCurrent',
	theme: prefer.s.lightTheme ?? defaultLightTheme,
	label: `${i18n.ts.light} / ${i18n.ts._emojiPreview.currentTheme}`,
}, {
	key: 'lightDefault',
	theme: defaultLightTheme,
	label: `${i18n.ts.light} / ${i18n.ts._emojiPreview.defaultTheme}`,
}, {
	key: 'darkCurrent',
	theme: prefer.s.darkTheme ?? defaultDarkTheme,
	label: `${i18n.ts.dark} / ${i18n.ts._emojiPreview.currentTheme}`,
}, {
	key: 'darkDefault',
	theme: defaultDarkTheme,
	label: `${i18n.ts.dark} / ${i18n.ts._emojiPreview.defaultTheme}`,
}]);
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: 1fr;
	gap: 6px;
	padding: 6px;
}

@container (min-width: 600px) {
	.root {
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		padding: 12px;
	}
}
</style>
