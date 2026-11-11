<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<MkInfo>{{ i18n.ts._announcement.groupsDescription }}</MkInfo>

	<MkLoading v-if="loading"/>
	<template v-else>
		<MkDraggable
			v-model="groups"
			direction="vertical"
			withGaps
			manualDragStart
		>
			<template #default="{ item, index, dragStart }">
				<div class="_panel" :class="$style.group" data-testid="announcement-group-item">
					<div :class="$style.groupHeader">
						<span :class="$style.handle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-menu"></i></span>
						<i :class="[announcementGroupIconClass(item.icon), $style.preview]"></i>
						<span :class="$style.groupName">{{ item.name || i18n.ts._announcement.groupName }}</span>
						<button class="_button" :class="$style.iconButton" :disabled="index === 0" :aria-label="i18n.ts._announcement.moveUp" @click="move(index, -1)"><i class="ti ti-arrow-up"></i></button>
						<button class="_button" :class="$style.iconButton" :disabled="index === groups.length - 1" :aria-label="i18n.ts._announcement.moveDown" @click="move(index, 1)"><i class="ti ti-arrow-down"></i></button>
						<button class="_button" :class="[$style.iconButton, $style.danger]" :aria-label="i18n.ts.delete" @click="del(item)"><i class="ti ti-trash"></i></button>
					</div>
					<div :class="$style.groupFields">
						<MkInput v-model="item.name">
							<template #label>{{ i18n.ts._announcement.groupName }}</template>
						</MkInput>
						<MkInput v-model="item.icon" placeholder="ti-speakerphone">
							<template #label>{{ i18n.ts._announcement.groupIcon }}</template>
							<template #caption>{{ i18n.ts._announcement.groupIconDescription }}</template>
						</MkInput>
					</div>
				</div>
			</template>
		</MkDraggable>

		<div class="_buttons">
			<MkButton rounded @click="add"><i class="ti ti-plus"></i> {{ i18n.ts._announcement.addGroup }}</MkButton>
			<MkButton rounded primary :disabled="!canSave" @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { genId } from '@/utility/id.js';
import { announcementGroupIconClass } from '@/utility/announcement-group.js';

type EditableGroup = {
	// MkDraggable 用のキー。保存済みのグループはその ID
	id: string;
	saved: Misskey.entities.AnnouncementGroup | null;
	name: string;
	icon: string;
};

const emit = defineEmits<{
	(ev: 'changed'): void;
}>();

const loading = ref(true);
const groups = ref<EditableGroup[]>([]);

const canSave = computed(() => groups.value.every(g => g.name.trim() !== ''));

async function fetchGroups() {
	loading.value = true;
	const res = await misskeyApi('admin/announcements/groups/list', {});
	groups.value = res.map(g => ({
		id: g.id,
		saved: g,
		name: g.name,
		icon: g.icon ?? '',
	}));
	loading.value = false;
}

fetchGroups();

function add() {
	groups.value = [...groups.value, {
		id: genId(),
		saved: null,
		name: '',
		icon: '',
	}];
}

function move(index: number, delta: -1 | 1) {
	const to = index + delta;
	if (to < 0 || to >= groups.value.length) return;
	const next = [...groups.value];
	[next[index], next[to]] = [next[to], next[index]];
	groups.value = next;
}

async function del(group: EditableGroup) {
	if (group.saved == null) {
		groups.value = groups.value.filter(g => g !== group);
		return;
	}

	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._announcement.deleteGroupConfirm({ name: group.saved.name }),
	});
	if (canceled) return;

	await os.apiWithDialog('admin/announcements/groups/delete', { id: group.saved.id });
	groups.value = groups.value.filter(g => g !== group);
	emit('changed');
}

async function save() {
	const tasks = groups.value.map((group, order) => {
		const name = group.name.trim();
		const icon = group.icon.trim() === '' ? null : group.icon.trim();
		if (group.saved == null) {
			return misskeyApi('admin/announcements/groups/create', { name, icon, order });
		}
		if (group.saved.name === name && group.saved.icon === icon && group.saved.order === order) return null;
		return misskeyApi('admin/announcements/groups/update', { id: group.saved.id, name, icon, order });
	});

	await os.promiseDialog(Promise.all(tasks));
	await fetchGroups();
	emit('changed');
}
</script>

<style lang="scss" module>
.group {
	padding: 8px 16px 16px 8px;
	container-type: inline-size;
}

.groupHeader {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 8px;
}

.handle {
	display: flex;
	flex-shrink: 0;
	width: 40px;
	height: 40px;
	align-items: center;
	justify-content: center;
	cursor: move;
}

.preview {
	flex-shrink: 0;
	width: 1.5em;
	text-align: center;
}

.groupName {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.iconButton {
	display: flex;
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	align-items: center;
	justify-content: center;
	border-radius: 6px;

	&:disabled {
		opacity: 0.3;
	}

	&:hover:not(:disabled) {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.danger {
	color: var(--MI_THEME-error);
}

.groupFields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
	padding-left: 8px;

	@container (max-width: 500px) {
		grid-template-columns: 1fr;
	}
}
</style>
