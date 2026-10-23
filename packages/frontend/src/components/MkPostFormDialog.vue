<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="'dialog'"
	@click="onBgClick"
	@closed="onModalClosed()"
	@esc="onEsc"
>
	<MkPostForm
		ref="form"
		:class="$style.form"
		class="_popup"
		v-bind="props"
		autofocus
		freezeAfterPosted
		@posted="onPosted"
		@cancel="_close()"
		@esc="_close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { PostFormProps } from '@/types/post-form.js';
import MkModal from '@/components/MkModal.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import { deviceKind } from '@/utility/device-kind.js';

const props = withDefaults(defineProps<PostFormProps & {
	instant?: boolean;
	fixed?: boolean;
	autofocus?: boolean;
}>(), {
	initialLocalOnly: undefined,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const form = useTemplateRef('form');

function onPosted() {
	modal.value?.close({
		useSendAnimation: true,
	});
}

async function _close() {
	const canClose = await form.value?.canClose();
	if (!canClose) return;
	form.value?.abortUploader();
	modal.value?.close();
}

function onEsc() {
	_close();
}

function onBgClick(ev?: MouseEvent) {
	// スマホではフォーム上部・横の余白タップで閉じないようにし、下側タップ時のみ閉じる
	// (PC ではフォームの周囲も広く、狙ってクリックできるため従来通り背景クリックで閉じる)
	if (ev && deviceKind === 'smartphone') {
		const formEl: HTMLElement | undefined = (form.value as ComponentPublicInstance | null)?.$el;
		if (formEl) {
			const rect = formEl.getBoundingClientRect();
			if (ev.clientY < rect.bottom) return;
		}
	}
	_close();
}

function onModalClosed() {
	emit('closed');
}
</script>

<style lang="scss" module>
.form {
	width: 100%;
	max-width: 520px;
	margin: 0 auto auto auto;
}
</style>
