<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkFolder>
	<template #icon><i class="ti ti-arrows-sort"></i></template>
	<template #label>{{ i18n.ts._announcement.reorder }}</template>
	<template #footer>
		<div class="_buttons">
			<MkButton rounded primary :disabled="!changed" @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
		</div>
	</template>

	<div class="_gaps_s">
		<div :class="$style.description">{{ i18n.ts._announcement.reorderDescription }}</div>
		<MkDraggable
			v-model="items"
			direction="vertical"
			withGaps
			manualDragStart
		>
			<template #default="{ item, index, dragStart }">
				<div :class="$style.item" data-testid="announcement-reorder-item">
					<span :class="$style.handle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-menu"></i></span>
					<span :class="$style.number">{{ index + 1 }}</span>
					<span :class="$style.title">{{ item.title }}</span>
					<button class="_button" :class="$style.move" :disabled="index === 0" :aria-label="i18n.ts._announcement.moveUp" @click="move(index, -1)"><i class="ti ti-arrow-up"></i></button>
					<button class="_button" :class="$style.move" :disabled="index === items.length - 1" :aria-label="i18n.ts._announcement.moveDown" @click="move(index, 1)"><i class="ti ti-arrow-down"></i></button>
				</div>
			</template>
		</MkDraggable>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import MkFolder from '@/components/MkFolder.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';

type Item = { id: string; title: string };

const props = defineProps<{
	groupId: string | null;
	announcements: Item[];
}>();

const emit = defineEmits<{
	(ev: 'saved'): void;
}>();

const items = ref<Item[]>([]);

watch(() => props.announcements, (to) => {
	items.value = to.map(x => ({ id: x.id, title: x.title }));
}, { immediate: true });

const changed = computed(() => items.value.map(x => x.id).join(',') !== props.announcements.map(x => x.id).join(','));

function move(index: number, delta: -1 | 1) {
	const to = index + delta;
	if (to < 0 || to >= items.value.length) return;
	const next = [...items.value];
	[next[index], next[to]] = [next[to], next[index]];
	items.value = next;
}

async function save() {
	await os.apiWithDialog('admin/announcements/reorder', {
		groupId: props.groupId,
		announcementIds: items.value.map(x => x.id),
	});
	emit('saved');
}
</script>

<style lang="scss" module>
.description {
	font-size: 0.85em;
	opacity: 0.7;
}

.item {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px 4px 0;
	border-radius: 6px;
	background: var(--MI_THEME-panel);
	border: solid 1px var(--MI_THEME-divider);
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

.number {
	flex-shrink: 0;
	min-width: 1.5em;
	opacity: 0.7;
}

.title {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.move {
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
</style>
