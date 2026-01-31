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
			<MkTime :time="note.createdAt" :mode="forceAbsoluteTime ? 'absolute' : 'relative'" colored/>
		</div>
		<MkA v-else :to="notePage(note)" @contextmenu="showTimeMenu">
			<MkTime :time="note.createdAt" :mode="forceAbsoluteTime ? 'absolute' : 'relative'" colored/>
		</MkA>
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
import { inject } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import { DI } from '@/di.js';
import * as os from '@/os.js';
import { mainRouter } from '@/router.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';

const props = defineProps<{
	note: Misskey.entities.Note;
}>();

const mock = inject(DI.mock, false);
const forceAbsoluteTime = inject<boolean>('forceAbsoluteTime', false);

function showTimeMenu(ev: MouseEvent) {
	ev.preventDefault();
	ev.stopPropagation();

	const noteDate = new Date(new Date(props.note.createdAt).getTime() + 60000);
	const year = noteDate.getFullYear();
	const month = String(noteDate.getMonth() + 1).padStart(2, '0');
	const day = String(noteDate.getDate()).padStart(2, '0');
	const hours = String(noteDate.getHours()).padStart(2, '0');
	const minutes = String(noteDate.getMinutes()).padStart(2, '0');
	const seconds = String(noteDate.getSeconds()).padStart(2, '0');
	const gotoParam = `${year}${month}${day}${hours}${minutes}${seconds}`;

	const menuItems = [];

	if (timemachineAvailable) {
		menuItems.push({
			icon: 'ti ti-clock-bolt',
			text: i18n.ts.jumpToTimemachine,
			action: () => {
				mainRouter.push(`/timemachine?goto=${gotoParam}` as any);
			},
		});
	}

	menuItems.push({
		icon: 'ti ti-external-link',
		text: i18n.ts.openInWindow,
		action: () => {
			os.pageWindow(notePage(props.note));
		},
	}, {
		icon: 'ti ti-link',
		text: i18n.ts.copyLink,
		action: () => {
			const url = `${location.protocol}//${location.host}${notePage(props.note)}`;
			copyToClipboard(url);
		},
	});

	os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
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
