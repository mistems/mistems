<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<!-- eslint-disable vue/no-mutating-props -->
<XContainer :draggable="true" :dragStartCallback="dragStartCallback" @remove="() => emit('remove')">
	<template #header><i class="ti ti-align-left"></i> {{ i18n.ts._pages.blocks.text }} - {{ i18n.ts._pages.otherMfm }}</template>

	<section>
		<div :class="$style.toolbar">
			<button class="_button" :class="$style.toolbarButton" @click="insertChar('$')">$MFM</button>
			<button class="_button" :class="$style.toolbarButton" @click="showMfmMenu">{{ i18n.ts._pages.otherMfm }}</button>
			<button class="_button" :class="$style.toolbarButton" @click="insertChar('#')">#</button>
			<button class="_button" :class="$style.toolbarButton" @click="insertEmoji"><i class="ti ti-mood-happy"></i></button>
		</div>
		<textarea ref="inputEl" v-model="text" :class="$style.textarea"></textarea>
	</section>
</XContainer>
</template>

<script lang="ts" setup>
import { nextTick, watch, ref, useTemplateRef, onMounted, onUnmounted } from 'vue';
import * as Misskey from 'misskey-js';
import insertTextAtCursor from 'insert-text-at-cursor';
import XContainer from '../page-editor.container.vue';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import * as os from '@/os.js';

const props = defineProps<{
	dragStartCallback?: (ev: DragEvent) => void;
	modelValue: Misskey.entities.PageBlock & { type: 'text' }
}>();

const emit = defineEmits<{
	(ev: 'update:modelValue', value: Misskey.entities.PageBlock & { type: 'text' }): void;
	(ev: 'remove'): void;
}>();

let autocomplete: Autocomplete;

const text = ref(props.modelValue.text ?? '');
const inputEl = useTemplateRef('inputEl');

watch(text, () => {
	emit('update:modelValue', {
		...props.modelValue,
		text: text.value,
	});
});

onMounted(() => {
	if (inputEl.value == null) return;
	autocomplete = new Autocomplete(inputEl.value, text);
});

onUnmounted(() => {
	autocomplete.detach();
});

function insertChar(ch: string) {
	if (inputEl.value == null) return;
	inputEl.value.focus();
	insertTextAtCursor(inputEl.value, ch);
}

function insertEmoji(ev: PointerEvent) {
	if (inputEl.value == null) return;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;

	let pos = inputEl.value.selectionStart ?? 0;
	let posEnd = inputEl.value.selectionEnd ?? text.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			const textBefore = text.value.substring(0, pos);
			const textAfter = text.value.substring(posEnd);
			text.value = textBefore + emoji + textAfter;
			pos += emoji.length;
			posEnd += emoji.length;
		},
		() => {
			nextTick(() => {
				if (inputEl.value) {
					inputEl.value.focus();
					inputEl.value.setSelectionRange(pos, posEnd);
				}
			});
		},
	);
}

function showMfmMenu(ev: PointerEvent) {
	const items: MenuItem[] = [
		{ text: '**Bold**', icon: 'ti ti-bold', action: () => insertTemplate('**Bold**') },
		{ text: '*Italic*', icon: 'ti ti-italic', action: () => insertTemplate('*Italic*') },
		{ text: '[Link]()', icon: 'ti ti-link', action: () => insertTemplate('[text](url)') },
		{ text: '<small>', icon: 'ti ti-text-decrease', action: () => insertTemplate('<small>text</small>') },
		{ text: '<center>', icon: 'ti ti-align-center', action: () => insertTemplate('<center>text</center>') },
		{ text: '<plain>', icon: 'ti ti-clear-formatting', action: () => insertTemplate('<plain>text</plain>') },
	];
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

function insertTemplate(tpl: string) {
	if (inputEl.value == null) return;
	inputEl.value.focus();
	insertTextAtCursor(inputEl.value, tpl);
}
</script>

<style lang="scss" module>
.toolbar {
	display: flex;
	gap: 2px;
	padding: 4px 8px;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.toolbarButton {
	padding: 4px 8px;
	font-size: 0.85em;
	border-radius: 4px;

	&:hover {
		background: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}
}

.textarea {
	display: block;
	-webkit-appearance: none;
	-moz-appearance: none;
	appearance: none;
	width: 100%;
	min-width: 100%;
	min-height: 150px;
	border: none;
	box-shadow: none;
	padding: 16px;
	background: transparent;
	color: var(--MI_THEME-fg);
	font-size: 14px;
	box-sizing: border-box;
}
</style>
