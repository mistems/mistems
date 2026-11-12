<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<!-- eslint-disable vue/no-mutating-props -->
<XContainer :draggable="true" :pointerStartCallback="pointerStartCallback" @remove="() => emit('remove')">
	<template #header><i class="ti ti-align-left"></i> {{ i18n.ts._pages.blocks.text }} - {{ i18n.ts._pages.otherMfm }}</template>

	<section>
		<div :class="$style.toolbar">
			<button class="_button" :class="$style.toolbarButton" @click="showFormatMenu">$MFM</button>
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
import { MFM_TAGS } from '@@/js/const.js';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import * as os from '@/os.js';

const props = defineProps<{
	pointerStartCallback?: (ev: PointerEvent) => void;
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

/**
 * $ の補完 (MkAutocomplete の mfmTag) と同じく、選んだ MFM 関数を `$[タグ ]` の形で入れる。
 * 選択範囲があれば `$[タグ 選択範囲]` で囲み、なければ `$[タグ ]` を入れてカーソルを中に置く。
 */
function applyMfmTag(tag: string) {
	const el = inputEl.value;
	if (!el) return;

	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	const selected = text.value.substring(start, end);
	const before = `$[${tag} `;

	text.value = text.value.substring(0, start) + before + selected + ']' + text.value.substring(end);

	nextTick(() => {
		el.focus();
		// 選択範囲を囲んだときは閉じ括弧のあと、何も選んでいないときは括弧の中にカーソルを置く
		const pos = selected ? start + before.length + selected.length + 1 : start + before.length;
		el.setSelectionRange(pos, pos);
	});
}

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

function showFormatMenu(ev: PointerEvent) {
	let applied = false;
	// $ を入力したときの補完と同じ一覧 (MFM_TAGS) を出す
	const items: MenuItem[] = MFM_TAGS.map(tag => ({
		text: `$[${tag}]`,
		action: () => {
			applied = true;
			applyMfmTag(tag);
		},
	}));
	// メニューは閉じるときにフォーカスをボタンへ戻すので、書式を当てたときはテキストエリアへ戻す (カーソルの位置は applyMfmTag で設定済み)
	os.popupMenu(items, ev.currentTarget ?? ev.target, {
		onClosed: () => {
			if (applied) nextTick(() => inputEl.value?.focus());
		},
	});
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
	flex-wrap: wrap;
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
