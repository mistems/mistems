<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<a
	ref="el"
	:href="href"
	:target="target"
	:rel="rel"
	:style="style"
	@click.prevent="onClick"
	@touchstart="onTouchstart"
	@touchmove="onTouchMove"
	@touchend="onTouchEnd"
	@contextmenu.prevent="onContextmenu"
>
	<slot></slot>
</a>
</template>

<script lang="ts">
export type MkABehavior = 'window' | 'browser' | null;
</script>

<script lang="ts" setup>
import { ref, inject } from 'vue';
import { url } from '@@/js/config.js';
import { useRouter } from '@/router';
import { popup } from '@/os';
import { i18n } from '@/i18n';
import { misskeyApi } from '@/utility/misskey-api';
import { $i } from '@/i';
import * as os from '@/os';
import { copyToClipboard } from '@/utility/copy-to-clipboard';

const props = defineProps<{
	to: string;
	behavior?: 'window' | 'browser' | 'modal' | 'replace' | 'replaceModal';
	rel?: string;
	style?: string;
	tag?: string;
}>();

const el = ref<HTMLAnchorElement>();
const router = useRouter();
let touchTimer: number | null = null;
let touchMoved = false;
let touchStartTime = 0;

const href = props.to.startsWith('http') ? props.to : `${url}${props.to}`;
const target = props.to.startsWith('http') ? '_blank' : undefined;
const rel = props.rel ?? 'nofollow noopener';

function onClick(ev: MouseEvent) {
	if (props.to.startsWith('http')) {
		window.open(href, target);
		return;
	}

	const behavior = props.behavior ?? inject<MkABehavior>('linkNavigationBehavior', null);

	switch (behavior) {
		case 'window':
			window.open(href, '_blank');
			break;
		case 'browser':
			window.location.href = href;
			break;
		case 'modal':
			popup(ev, href);
			break;
		case 'replace':
			router.replace(props.to);
			break;
		case 'replaceModal':
			router.replace(props.to);
			popup(ev, href);
			break;
		default:
			router.push(props.to);
			break;
	}
}

function onTouchstart(ev: TouchEvent) {
	// iOSの文字選択を防ぐ
	ev.preventDefault();
	
	// フラグ初期化
	touchMoved = false;
	touchStartTime = Date.now();
	
	// 長押しでコンテキストメニューを表示
	touchTimer = window.setTimeout(() => {
		// TouchEventをMouseEventに変換
		const mouseEvent = new MouseEvent('contextmenu', {
			clientX: ev.touches[0].clientX,
			clientY: ev.touches[0].clientY,
		});
		onContextmenu(mouseEvent);
	}, 500);
}

function onTouchMove() {
	touchMoved = true;
	if (touchTimer) {
		window.clearTimeout(touchTimer);
		touchTimer = null;
	}
}

function onTouchEnd(ev: TouchEvent) {
	if (touchTimer) {
		window.clearTimeout(touchTimer);
		touchTimer = null;
		
		// クリック判定：touchmoveがなく、長押し時間未満の場合
		if (!touchMoved && Date.now() - touchStartTime < 500) {
			// TouchEventをMouseEventに変換してonClickを呼び出し
			const mouseEvent = new MouseEvent('click', {
				clientX: ev.changedTouches[0].clientX,
				clientY: ev.changedTouches[0].clientY,
			});
			onClick(mouseEvent);
		}
	}
}

function onContextmenu(ev: MouseEvent) {
	const tag = decodeURIComponent(props.to.split('/').pop() || '');
	
	const items = [
		{
			type: 'label' as const,
			text: `#${tag}`,
		},
		{
			icon: 'ti ti-app-window',
			text: i18n.ts.openInWindow,
			action: () => {
				os.pageWindow(props.to);
			},
		},
		{
			icon: 'ti ti-player-eject',
			text: i18n.ts.showInPage,
			action: () => {
				router.push(props.to, 'forcePage');
			},
		},
		{ type: 'divider' as const },
		{
			icon: 'ti ti-link',
			text: i18n.ts.copyLink,
			action: () => {
				copyToClipboard(href);
			},
		},
		{ type: 'divider' as const },
		{
			icon: 'ti ti-eye-off',
			text: i18n.ts.wordMute,
			action: async () => {
				if (!$i) return;
				const mutedWords = $i.mutedWords || [];
				await misskeyApi('i/update', {
					mutedWords: [...mutedWords, [tag]],
				});
			},
		},
		{
			icon: 'ti ti-message-off',
			text: i18n.ts.hardWordMute,
			action: async () => {
				if (!$i) return;
				const hardMutedWords = $i.hardMutedWords || [];
				await misskeyApi('i/update', {
					hardMutedWords: [...hardMutedWords, [tag]],
				});
			},
		},
	];

	os.contextMenu(items, ev);
}
</script>

<style lang="scss" module>
.root {
	touch-action: manipulation;
}

a {
	text-decoration: none;
	transition: opacity 0.1s ease;
	
	&:active {
		opacity: 0.7;
		text-decoration: underline;
	}
}
</style>
    
