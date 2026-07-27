<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>ショートカット抜粋</template>
	<div style="padding: 24px;">
		<ul>
			<li>h：ヘルプ</li>
			<li>p：投稿ダイアログを開く（パブリック）</li>
			<li>n：投稿ダイアログを開く（チャンネルならチャンネルへ）</li>
			<li>d：ダークモード/ライトモード切り替え</li>
			<li>s：検索</li>
			<li>↑↓：ノートを選択</li>
		</ul>
		<MkButton primary @click="dialog?.close()">OK</MkButton>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');
</script>
