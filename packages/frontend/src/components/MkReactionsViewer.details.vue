<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkTooltip ref="tooltip" :showing="showing" :targetElement="targetElement" :maxWidth="340" @closed="emit('closed')">
	<div :class="$style.root">
		<div :class="$style.reaction">
			<MkReactionIcon :reaction="reaction" :class="$style.reactionIcon" :noStyle="true"/>
			<div :class="$style.reactionName">{{ getReactionName(reaction) }}</div>
		</div>
		<div :class="$style.users">
			<div v-for="u in users" :key="u.id" :class="$style.user">
				<MkAvatar :class="$style.avatar" :user="u"/>
				<MkUserName :user="u" :nowrap="true"/>
			</div>
			<div v-if="count > 10" :class="$style.more">+{{ count - 10 }}</div>
		</div>
	</div>
	<div v-if="getEmoji(reaction)">
		<p>カテゴリ：{{ getEmoji(reaction).category }}</p>
		<p>ヨミ：{{ getEmoji(reaction).aliases }}</p>
		<p v-if="getEmoji(reaction).license">ライセンス：{{getEmoji(reaction).license }}</p>
		<p v-if="getEmoji(reaction).localOnly">ローカルのみ</p>
		<p v-if="getEmoji(reaction).isSensitive">センシティブ</p>
	</div>
</MkTooltip>
</template>

<script lang="ts" setup>
import { getEmojiName } from '@@/js/emojilist.js';
import MkTooltip from './MkTooltip.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import {customEmojisByName} from "@/custom-emojis.js";
import type {entities} from "misskey-js"

defineProps<{
	showing: boolean;
	reaction: string;
	users: any[]; // TODO
	count: number;
	targetElement: HTMLElement;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();


function getEmoji(reaction: string): entities.EmojiSimple {
	return customEmojisByName.value[getReactionName(reaction)];
}

function getReactionName(reaction: string): string {
	const trimLocal = reaction.replace('@.', '');
	if (trimLocal.startsWith(':')) {
		return trimLocal;
	}
	return getEmojiName(reaction);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
}

.reaction {
	max-width: 100px;
	padding-right: 10px;
	text-align: center;
	border-right: solid 0.5px var(--MI_THEME-divider);
}

.reactionIcon {
	display: block;
	width: 60px;
	max-height: 60px;
	font-size: 60px; // unicodeな絵文字についてはwidthが効かないため
	object-fit: contain;
	margin: 0 auto;
}

.reactionName {
	font-size: 1em;
}

.users {
	flex: 1;
	min-width: 0;
	margin: -4px 14px 0 10px;
	font-size: 0.95em;
	text-align: left;
}

.user {
	display: flex;
	line-height: 24px;
	padding-top: 4px;
	white-space: nowrap;
	overflow: visible;
	text-overflow: ellipsis;
}

.avatar {
	width: 24px;
	height: 24px;
	margin-right: 3px;
}

.more {
	padding-top: 4px;
}
</style>
