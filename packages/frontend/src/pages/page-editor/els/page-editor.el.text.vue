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

type MfmFormat = {
	id: string;
	label: string;
	icon: string;
	before: string;
	after: string;
	multilineOk: boolean;
};

const MFM_FORMATS: MfmFormat[] = [
	{ id: 'bold', label: '太字', icon: 'ti ti-bold', before: '**', after: '**', multilineOk: false },
	{ id: 'italic', label: 'イタリック', icon: 'ti ti-italic', before: '*', after: '*', multilineOk: false },
	{ id: 'strike', label: '打ち消し', icon: 'ti ti-strikethrough', before: '~~', after: '~~', multilineOk: false },
	{ id: 'center', label: '中央寄せ', icon: 'ti ti-align-center', before: '<center>', after: '</center>', multilineOk: true },
	{ id: 'small', label: '小さく', icon: 'ti ti-letter-case-lower', before: '<small>', after: '</small>', multilineOk: true },
	{ id: 'code', label: 'インラインコード', icon: 'ti ti-code', before: '`', after: '`', multilineOk: false },
	{ id: 'codeblock', label: 'コードブロック', icon: 'ti ti-code-dots', before: '```\n', after: '\n```', multilineOk: true },
	{ id: 'x2', label: '2倍サイズ', icon: 'ti ti-zoom-in', before: '$[x2 ', after: ']', multilineOk: true },
	{ id: 'rainbow', label: '虹色', icon: 'ti ti-rainbow', before: '$[rainbow ', after: ']', multilineOk: true },
	{ id: 'spin', label: '回転', icon: 'ti ti-rotate-clockwise', before: '$[spin ', after: ']', multilineOk: true },
	{ id: 'blur', label: 'ぼかし', icon: 'ti ti-eye-off', before: '$[blur ', after: ']', multilineOk: true },
];

let autocomplete: Autocomplete;

const text = ref(props.modelValue.text ?? '');
const inputEl = useTemplateRef('inputEl');

watch(text, () => {
	emit('update:modelValue', {
		...props.modelValue,
		text: text.value,
	});
});

function applyFormat(fmt: MfmFormat) {
	const el = inputEl.value;
	if (!el) return;

	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	const selected = text.value.substring(start, end);

	if (!fmt.multilineOk && selected.includes('\n')) {
		os.toast(i18n.ts._pages.mfmNoMultiline);
		return;
	}

	const placeholder = 'テキスト';
	const inner = selected || placeholder;

	text.value = text.value.substring(0, start) + fmt.before + inner + fmt.after + text.value.substring(end);

	nextTick(() => {
		el.focus();
		if (selected) {
			const pos = start + fmt.before.length + selected.length + fmt.after.length;
			el.setSelectionRange(pos, pos);
		} else {
			const selStart = start + fmt.before.length;
			el.setSelectionRange(selStart, selStart + placeholder.length);
		}
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
	const items: MenuItem[] = MFM_FORMATS.map(fmt => ({
		text: fmt.label,
		icon: fmt.icon,
		action: () => {
			applied = true;
			applyFormat(fmt);
		},
	}));
	// メニューは閉じるときにフォーカスをボタンへ戻すので、書式を当てたときはテキストエリアへ戻す (選択範囲は applyFormat で設定済み)
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
