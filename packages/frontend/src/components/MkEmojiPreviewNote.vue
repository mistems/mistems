<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
	画像を絵文字として登録したときの見え方を確かめるための、見た目だけのダミーのノート。
	テーマの CSS 変数はこの部品の root にだけ当て、ページ全体のテーマは変えない。
	文字・絵文字・リアクションの大きさは、利用者の設定によらず既定 (中) の大きさに固定する。
-->

<template>
<div :class="$style.root" :style="themeVars">
	<article :class="$style.article">
		<MkAvatar v-if="user" :class="$style.avatar" :user="user"/>
		<div v-else :class="[$style.avatar, $style.avatarPlaceholder]"></div>
		<div :class="$style.main">
			<header :class="$style.header">
				<div :class="$style.name">
					<MkUserName v-if="user" :user="user"/>
					<template v-else>{{ host }}</template>
				</div>
				<div v-if="user" :class="$style.username"><MkAcct :user="user"/></div>
				<div :class="$style.time"><MkTime :time="time"/></div>
			</header>
			<div :class="$style.text">
				<div><MkCustomEmoji :name="emojiName" :url="emojiUrl" :ignoreMuted="true"/></div>
				<div><MkCustomEmoji v-for="i in 3" :key="i" :name="emojiName" :url="emojiUrl" :ignoreMuted="true"/></div>
			</div>
			<div :class="$style.footer">
				<div :class="$style.reaction">
					<MkCustomEmoji :class="$style.reactionIcon" :name="emojiName" :url="emojiUrl" :normal="true" :fallbackToImage="true" :ignoreMuted="true"/>
					<span :class="$style.reactionCount">1</span>
				</div>
				<div :class="$style.label">
					<div>{{ label }}</div>
					<div>{{ theme.name }}</div>
				</div>
			</div>
		</div>
	</article>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import type { Theme } from '@@/js/theme.js';
import { compileTheme, compiledThemeToCssVars } from '@/theme.js';

const props = defineProps<{
	emojiUrl: string;
	emojiName: string;
	theme: Theme;
	label: string;
	user?: Misskey.entities.User | null;
}>();

const time = new Date();

const themeVars = computed(() => ({
	...compiledThemeToCssVars(compileTheme(props.theme)),
	colorScheme: props.theme.base === 'dark' ? 'dark' : 'light',
}));
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
	/* 利用者の文字の大きさの設定によらず、既定 (中) の大きさにする */
	font-size: 14px;
	line-height: 1.35;
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
	border-radius: var(--MI-radius);
	padding: 6px;
	box-sizing: border-box;
}

/* 以下の大きさは MkNote.vue / MkNoteHeader.vue / MkReactionsViewer.reaction.vue の既定に合わせる */
.article {
	display: flex;
	padding: 28px 32px;
	font-size: 1.05em;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.avatar {
	flex-shrink: 0;
	display: block !important;
	margin: 0 14px 0 0;
	width: 58px;
	height: 58px;
}

.avatarPlaceholder {
	border-radius: 100%;
	background: var(--MI_THEME-accentedBg);
}

.main {
	flex: 1;
	min-width: 0;
}

.header {
	display: flex;
	align-items: baseline;
	white-space: nowrap;
}

.name {
	flex-shrink: 1;
	margin: 0 .5em 0 0;
	overflow: hidden;
	font-weight: bold;
	text-overflow: ellipsis;
}

.username {
	flex-shrink: 9999999;
	margin: 0 .5em 0 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.time {
	flex-shrink: 0;
	margin-left: auto;
	font-size: 0.9em;
}

.text {
	overflow-wrap: break-word;
}

.footer {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	margin-top: 6px;
}

.reaction {
	display: inline-flex;
	height: 42px;
	padding: 0 6px;
	font-size: 1.5em;
	border-radius: 6px;
	align-items: center;
	justify-content: center;
	background: var(--MI_THEME-buttonBg);
}

.reactionIcon {
	max-width: 70px;
	object-fit: contain;
}

.reactionCount {
	font-size: 0.7em;
	line-height: 42px;
	margin: 0 0 0 4px;
}

.label {
	margin-left: auto;
	min-width: 0;
	font-size: 0.75em;
	text-align: right;
	opacity: 0.7;

	> div {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

@container (max-width: 580px) {
	.article {
		font-size: 0.95em;
		padding: 24px 26px;
	}

	.avatar {
		width: 50px;
		height: 50px;
	}
}

@container (max-width: 500px) {
	.article {
		font-size: 0.9em;
		padding: 20px 22px;
	}
}

@container (max-width: 480px) {
	.article {
		padding: 14px 16px;
	}
}

@container (max-width: 450px) {
	.avatar {
		margin: 0 10px 0 0;
		width: 46px;
		height: 46px;
	}
}

@container (max-width: 300px) {
	.avatar {
		width: 44px;
		height: 44px;
	}
}
</style>
