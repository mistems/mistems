<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<!-- eslint-disable vue/no-mutating-props -->
<XContainer :draggable="true" :dragStartCallback="dragStartCallback" @remove="() => emit('remove')">
	<template #header><i class="ti ti-photo"></i> {{ i18n.ts._pages.blocks.image }}</template>
	<template #func>
		<button @click="choose()">
			<i class="ti ti-folder"></i>
		</button>
	</template>

	<section>
		<MkDriveFileThumbnail v-if="file" style="height: 150px;" :file="file" fit="contain" @click="choose()"/>
	</section>
</XContainer>
</template>

<script lang="ts" setup>

import { inject, onMounted, ref, type Ref } from 'vue';
import * as Misskey from 'misskey-js';
import XContainer from '../page-editor.container.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { chooseDriveFile } from '@/utility/drive.js';

const props = defineProps<{
	dragStartCallback?: (ev: DragEvent) => void;
	modelValue: Misskey.entities.PageBlock & { type: 'image' };
}>();

const emit = defineEmits<{
	(ev: 'update:modelValue', value: Misskey.entities.PageBlock & { type: 'image' }): void;
	(ev: 'remove'): void;
}>();

const pageEditorFiles = inject<Ref<Record<string, Misskey.entities.DriveFile>>>('pageEditorFiles');

const file = ref<Misskey.entities.DriveFile | null>(null);

function registerFile(driveFile: Misskey.entities.DriveFile) {
	if (pageEditorFiles) {
		pageEditorFiles.value[driveFile.id] = driveFile;
	}
}

async function choose() {
	chooseDriveFile({ multiple: false }).then((fileResponse) => {
		file.value = fileResponse[0];
		registerFile(file.value);
		emit('update:modelValue', {
			...props.modelValue,
			fileId: file.value.id,
		});
	});
}

onMounted(async () => {
	if (props.modelValue.fileId == null) {
		await choose();
	} else {
		const cached = pageEditorFiles?.value[props.modelValue.fileId];
		if (cached) {
			file.value = cached;
		} else {
			misskeyApi('drive/files/show', {
				fileId: props.modelValue.fileId,
			}).then(fileResponse => {
				file.value = fileResponse;
				registerFile(fileResponse);
			});
		}
	}
});
</script>
