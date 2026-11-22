<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="to" :behavior="behavior" :extraMenuItems="$i != null ? getMuteMenuItems : null">
	<slot></slot>
</MkA>
</template>

<script lang="ts" setup>
import type { MkABehavior } from '@/components/global/MkA.vue';
import type { MenuItem } from '@/types/menu.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	to: string;
	/** 先頭の # を除いたタグ */
	hashtag: string;
	behavior?: MkABehavior;
}>();

type MuteKind = 'mutedWords' | 'hardMutedWords';

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// ワードミュートは本文の文字列で判定する。ハッシュタグは大文字・小文字を区別しないので、
// 「# + タグ」のあとにタグの続き (文字・数字・_) が来ないものを、大文字・小文字を区別せずに探す正規表現で登録する。
// サーバーの RE2 は先読みに対応していないので、先読みを使わずに書く
function muteRegExp(): string {
	return `/#${escapeRegExp(props.hashtag)}(?:[^\\p{L}\\p{N}_]|$)/iu`;
}

function isMuted(words: (string | string[])[]): boolean {
	return words.some(w => w === muteRegExp());
}

async function mute(kind: MuteKind) {
	if ($i == null) return;
	const words = $i[kind];
	if (isMuted(words)) return;
	await os.apiWithDialog('i/update', { [kind]: [...words, muteRegExp()] });
}

function getMuteMenuItems(): MenuItem[] {
	if ($i == null) return [];
	const items: MenuItem[] = [{
		type: 'label',
		text: `#${props.hashtag}`,
	}];
	// すでにミュートしている種類は出さない
	if (!isMuted($i.mutedWords)) {
		items.push({ icon: 'ti ti-eye-off', text: i18n.ts.wordMute, action: () => mute('mutedWords') });
	}
	if (!isMuted($i.hardMutedWords)) {
		items.push({ icon: 'ti ti-message-off', text: i18n.ts.hardWordMute, action: () => mute('hardMutedWords') });
	}
	return items.length > 1 ? items : [];
}
</script>
