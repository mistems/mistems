<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.editorWithPreview">
	<div :class="$style.editorColumn">
		<XBlocks v-model="content"/>
		<MkButton v-if="!readonly" rounded :class="$style.addButton" @click="add()"><i class="ti ti-plus"></i></MkButton>
	</div>

	<div :class="$style.previewColumn">
		<div :class="$style.previewHeader">
			<i class="ti ti-eye"></i> {{ i18n.ts.preview }}
		</div>
		<div :class="$style.previewBody">
			<XPage :page="previewPage"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import XBlocks from './page-editor.blocks.vue';
import XPage from '@/components/page/page.vue';
import { genId } from '@/utility/id.js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { getPageBlockList, pageEditorInjectionKey } from '@/pages/page-editor/common.js';

const {
	readonly,
	content,
	previewPage,
} = inject(pageEditorInjectionKey)!;

async function add() {
	const { canceled, result: type } = await os.select({
		title: i18n.ts._pages.chooseBlock,
		items: getPageBlockList(),
	});
	if (canceled || type == null) return;

	const id = genId();

	if (type === 'text') {
		content.value.push({ id, type, text: '' });
	} else if (type === 'section') {
		content.value.push({ id, type, title: '', children: [] });
	} else if (type === 'image') {
		content.value.push({ id, type, fileId: null });
	} else if (type === 'note') {
		content.value.push({ id, type, detailed: false, note: null });
	}
}
</script>

<style lang="scss" module>
.editorWithPreview {
	display: flex;
	gap: 16px;
	align-items: flex-start;

	@media (max-width: 850px) {
		flex-direction: column;
	}
}

.editorColumn {
	flex: 1;
	min-width: 0;
}

.addButton {
	margin: 16px auto 0 auto;
}

.previewColumn {
	flex: 1;
	min-width: 0;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	overflow: hidden;

	@media (max-width: 850px) {
		width: 100%;
	}
}

.previewHeader {
	padding: 10px 16px;
	font-size: 0.85em;
	font-weight: bold;
	border-bottom: 1px solid var(--MI_THEME-divider);
	color: var(--MI_THEME-fgTransparentWeak);

	> i {
		margin-right: 6px;
	}
}

.previewBody {
	padding: 16px;
	min-height: 100px;
}
</style>
