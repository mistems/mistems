<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkAvatar :class="$style.avatar" :user="user"/>
	<div :class="$style.main">
		<div :class="$style.header">
			<MkUserName :user="user" :nowrap="true"/>
		</div>
		<div>
			<p v-if="useCw" :class="$style.cw">
				<Mfm v-if="cw != null && cw != ''" :text="highlightedCw!" :author="user" :nyaize="'respect'" :i="user" style="margin-right: 8px;"/>
				<MkCwButton v-model="showContent" :text="text.trim()" :files="files" :poll="poll" style="margin: 4px 0;"/>
			</p>
			<div v-show="!useCw || showContent">
				<Mfm :text="highlightedText" :author="user" :nyaize="'respect'" :i="user"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import type { PollEditorModelValue } from '@/components/MkPollEditor.vue';
import MkCwButton from '@/components/MkCwButton.vue';
import { highlightSensitiveWords } from '@/utility/sensitive-words.js';

const showContent = ref(false);

const props = defineProps<{
	text: string;
	files: Misskey.entities.DriveFile[];
	poll?: PollEditorModelValue;
	useCw: boolean;
	cw: string | null;
	user: Misskey.entities.User;
	sensitiveWords?: string[];
}>();

// サーバーのセンシティブワード判定は cw があれば cw、無ければ text を対象にする。
// それに合わせてハイライト対象も切り替える。
const isCwTarget = computed(() => props.useCw && props.cw != null && props.cw !== '');

const highlightedText = computed(() => {
	const t = props.text.trim();
	if (!props.sensitiveWords?.length || isCwTarget.value) return t;
	return highlightSensitiveWords(t, props.sensitiveWords);
});

const highlightedCw = computed(() => {
	if (!props.sensitiveWords?.length || !isCwTarget.value) return props.cw;
	return highlightSensitiveWords(props.cw!, props.sensitiveWords);
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	margin: 0;
	padding: 0;
	overflow: clip;
	font-size: 0.95em;
}

.avatar {
	flex-shrink: 0 !important;
	display: block !important;
	margin: 0 10px 0 0 !important;
	width: 40px !important;
	height: 40px !important;
	border-radius: 8px !important;
	pointer-events: none !important;
}

.main {
	flex: 1;
	min-width: 0;
}

.cw {
	cursor: default;
	display: block;
	margin: 0;
	padding: 0;
	overflow-wrap: break-word;
}

.header {
	margin-bottom: 2px;
	font-weight: bold;
	width: 100%;
	overflow: clip;
    text-overflow: ellipsis;
}

@container (min-width: 350px) {
	.avatar {
		margin: 0 10px 0 0 !important;
		width: 44px !important;
		height: 44px !important;
	}
}

@container (min-width: 500px) {
	.avatar {
		margin: 0 12px 0 0 !important;
		width: 48px !important;
		height: 48px !important;
	}
}
</style>
