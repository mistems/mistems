<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<MkModalWindow ref="self" @close="self.close()" @closed="self.close()" @esc="self.close()" @click="self.close()">
		<template v-slot:header>ショートカット抜粋</template>
		<div style="padding:24px;">
			<ul>
				<li>h：ヘルプ</li>
				<li>p：投稿ダイアログを開く（パブリック）</li>
				<li>n：投稿ダイアログを開く（チャンネルならチャンネルへ）</li>
				<li>d：ダークモード/ライトモード切り替え</li>
				<li>s：検索</li>
				<li>↑↓：ノートを選択</li>
			</ul>
			<MkButton primary @click="self.close()">OK</MkButton>
		</div>
	</MkModalWindow>
</template>

<script setup lang="ts">

import MkModalWindow from "@/components/MkModalWindow.vue";
import MkButton from "@/components/MkButton.vue";
import {ref} from "vue";

const self= ref(null)

</script>

<style lang="scss" module>
.root {
	position: relative;
	container-type: inline-size;

	&.modal {
		width: 100%;
		max-width: 520px;
	}
}

//#region header
.header {
	z-index: 1000;
	min-height: 50px;
	display: flex;
	flex-wrap: nowrap;
	gap: 4px;
}

.headerLeft {
	display: flex;
	flex: 0 1 100px;
}

.cancel {
	padding: 0;
	font-size: 1em;
	height: 100%;
	flex: 0 1 50px;
}

</style>
