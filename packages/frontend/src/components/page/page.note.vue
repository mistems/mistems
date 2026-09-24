<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkNote v-if="note && !block.detailed" :key="note.id + ':normal'" :note="note"/>
	<MkNoteDetailed v-if="note && block.detailed" :key="note.id + ':detail'" :note="note"/>
</div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkNote from '@/components/MkNote.vue';
import MkNoteDetailed from '@/components/MkNoteDetailed.vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	block: Extract<Misskey.entities.PageBlock, { type: 'note' }>,
	page: Misskey.entities.Page,
}>();

const note = ref<Misskey.entities.Note | null>(null);

watch(() => props.block.note, (noteId) => {
	if (noteId == null) {
		note.value = null;
		return;
	}
	misskeyApi('notes/show', { noteId })
		.then(result => {
			note.value = result;
		});
}, { immediate: true, flush: 'post' });
</script>

<style lang="scss" module>
.root {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
}
</style>
