<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div v-if="mock" :class="$style.name">
		<MkUserName :user="note.user"/>
	</div>
	<MkA v-else v-user-preview="note.user.id" :class="$style.name" :to="userPage(note.user)">
		<MkUserName :user="note.user"/>
	</MkA>
	<div v-if="note.user.isBot" :class="$style.isBot">bot</div>
	<div :class="$style.username"><MkAcct :user="note.user"/></div>
	<div v-if="note.user.badgeRoles" :class="$style.badgeRoles">
		<img v-for="(role, i) in note.user.badgeRoles" :key="i" v-tooltip="role.name" :class="$style.badgeRole" :src="role.iconUrl!"/>
	</div>
	<div :class="$style.info">
		<div v-if="mock">
			<MkTime :time="note.createdAt" :mode="timeMode" colored/>
		</div>
		<!-- MkA も右クリックで自前のメニューを出すので、先 (capture) で受け取って MkA まで届かないようにする -->
		<span v-else @contextmenu.capture="showTimeMenu">
			<MkA :to="notePage(note)">
				<MkTime :time="note.createdAt" :mode="timeMode" colored/>
			</MkA>
		</span>
		<span v-if="note.visibility !== 'public'" style="margin-left: 0.5em;" :title="i18n.ts._visibility[note.visibility]">
			<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
			<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
			<i v-else-if="note.visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
		</span>
		<span v-if="note.localOnly" style="margin-left: 0.5em;" :title="i18n.ts._visibility['disableFederation']"><i class="ti ti-rocket-off"></i></span>
		<span v-if="note.channel" style="margin-left: 0.5em;" :title="note.channel.name"><i class="ti ti-device-tv"></i></span>
	</div>
</header>
</template>

<script lang="ts" setup>
import { inject, computed } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@@/js/note.js';
import { userPage } from '@@/js/user.js';
import { DI } from '@/di.js';
import * as os from '@/os.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';
import { formatTimestamp } from '@/utility/timemachine-format.js';
import { useRouter } from '@/router.js';
import { url } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	isRealtime?: boolean;
}>(), {
	isRealtime: false,
});

const router = useRouter();
const mock = inject(DI.mock, false);
const forceAbsoluteTime = inject<boolean>('forceAbsoluteTime', false);

// リアルタイムノートの場合は常に相対時刻を使用
const timeMode = computed(() => props.isRealtime ? 'relative' : (forceAbsoluteTime ? 'absolute' : 'relative'));

// 時刻のリンクのメニュー。MkA の共通メニュー (ウィンドウで開く・ページで表示など) に、タイムマシンへの移動を足したもの
function showTimeMenu(ev: MouseEvent) {
	const selection = window.getSelection();
	if (selection && selection.toString() !== '') return;
	ev.preventDefault();
	ev.stopPropagation();

	const path = notePage(props.note);
	const menuItems: MenuItem[] = [{
		type: 'label',
		text: path,
	}, {
		icon: 'ti ti-app-window',
		text: i18n.ts.openInWindow,
		action: () => {
			os.pageWindow(path);
		},
	}, {
		icon: 'ti ti-player-eject',
		text: i18n.ts.showInPage,
		action: () => {
			router.pushByPath(path, 'forcePage');
		},
	}, { type: 'divider' }, {
		icon: 'ti ti-external-link',
		text: i18n.ts.openInNewTab,
		action: () => {
			window.open(path, '_blank', 'noopener');
		},
	}, {
		icon: 'ti ti-link',
		text: i18n.ts.copyLink,
		action: () => {
			copyToClipboard(`${url}${path}`);
		},
	}];

	if (timemachineAvailable) {
		// ノートの作成時刻に1分加算してタイムマシンへのジャンプ時刻を生成
		const noteTimestamp = new Date(props.note.createdAt).getTime() + 60000;
		const timemachinePath = `/timemachine?goto=${formatTimestamp(noteTimestamp, 'goto')}`;
		menuItems.push({ type: 'divider' }, {
			type: 'parent',
			icon: 'ti ti-clock-bolt',
			text: i18n.ts.jumpToTimemachine,
			children: [{
				icon: 'ti ti-app-window',
				text: i18n.ts.openInWindow,
				action: () => {
					os.pageWindow(timemachinePath);
				},
			}, {
				icon: 'ti ti-player-eject',
				text: i18n.ts.showInPage,
				action: () => {
					router.pushByPath(timemachinePath, 'forcePage');
				},
			}],
		});
	}

	os.contextMenu(menuItems, ev);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: baseline;
	white-space: nowrap;
}

.name {
	flex-shrink: 1;
	display: block;
	margin: 0 .5em 0 0;
	padding: 0;
	overflow: hidden;
	font-size: 1em;
	font-weight: bold;
	text-decoration: none;
	text-overflow: ellipsis;

	&:hover {
		text-decoration: underline;
	}
}

.isBot {
	flex-shrink: 0;
	align-self: center;
	margin: 0 .5em 0 0;
	padding: 1px 6px;
	font-size: 80%;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 3px;
}

.username {
	flex-shrink: 9999999;
	margin: 0 .5em 0 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.info {
	flex-shrink: 0;
	margin-left: auto;
	font-size: 0.9em;
}

.badgeRoles {
	margin: 0 .5em 0 0;
}

.badgeRole {
	height: 1.3em;
	vertical-align: -20%;

	& + .badgeRole {
		margin-left: 0.2em;
	}
}
</style>
