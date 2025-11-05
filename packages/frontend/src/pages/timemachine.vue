<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<MkPageHeader :actions="headerActions" :displayBackButton="true">
		<template #title>Time Machine</template>
		<template #icon><i class="ti ti-clock-bolt"></i></template>
	</MkPageHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div :class="$style.controls" class="_panel">
			<div :class="$style.dateTimeSection">
				<div :class="$style.label">Select date and time</div>
				<div :class="$style.dateTimeInputs">
					<MkInput v-model="dateInput" type="date" :max="todayString" style="flex: 1;">
						<template #label>Date</template>
					</MkInput>
					<MkInput v-model="timeInput" type="time" style="flex: 1;">
						<template #label>Time</template>
					</MkInput>
				</div>
			</div>
			<div :class="$style.buttonSection">
				<MkButton primary @click="goToDateTime" :disabled="!isValidDateTime">
					<i class="ti ti-clock"></i> Go to selected time
				</MkButton>
				<MkButton @click="goToNow" v-if="targetDate !== null">
					<i class="ti ti-calendar-time"></i> Back to now
				</MkButton>
			</div>
			<div v-if="targetDate !== null" :class="$style.currentPosition">
				<i class="ti ti-map-pin"></i>
				Current position: {{ formatDateTime(targetDate) }}
			</div>
		</div>

		<div v-if="paginator !== null" ref="scrollContainer" style="margin-top: var(--MI-margin); overflow-y: auto; height: 100vh;">
			<div v-if="targetDate !== null && canLoadNewer" :class="$style.newerSection">
				<MkButton @click="loadNewer" :disabled="isLoadingNewer">
					<i class="ti ti-arrow-up"></i> Load newer notes
				</MkButton>
			</div>
			<MkNotesTimeline
				ref="tlComponent"
				:key="timelineKey"
				:paginator="paginator"
			/>
		</div>
		<div v-else :class="$style.placeholder">
			<div :class="$style.placeholderIcon">
				<i class="ti ti-clock-bolt"></i>
			</div>
			<div :class="$style.placeholderText">
				Select a date and time to view the timeline from that moment.
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, markRaw, watch, useTemplateRef, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import { definePage } from '@/page.js';
import { store } from '@/store.js';
import { Paginator } from '@/utility/paginator.js';
import type { IPaginator } from '@/utility/paginator.js';

const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer');

// Timeline filters (reuse from timeline page)
const withRenotes = computed<boolean>({
	get: () => store.r.tl.value.filter.withRenotes,
	set: (x) => {
		const out = { ...store.s.tl, filter: { ...store.s.tl.filter, withRenotes: x } };
		store.set('tl', out);
	},
});

const withReplies = computed<boolean>({
	get: () => store.r.tl.value.filter.withReplies,
	set: (x) => {
		const out = { ...store.s.tl, filter: { ...store.s.tl.filter, withReplies: x } };
		store.set('tl', out);
	},
});

const onlyFiles = computed<boolean>({
	get: () => store.r.tl.value.filter.onlyFiles,
	set: (x) => {
		const out = { ...store.s.tl, filter: { ...store.s.tl.filter, onlyFiles: x } };
		store.set('tl', out);
	},
});

// Date/time input
const now = new Date();
const dateInput = ref<string>(`${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`);
const timeInput = ref<string>(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
const targetDate = ref<number | null>(null);
const timelineKey = ref<number>(0);
const paginator = ref<IPaginator<Misskey.entities.Note> | null>(null);
const isLoadingNewer = ref<boolean>(false);
const currentNewestNoteId = ref<string | null>(null);

const todayString = computed(() => {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
});

const isValidDateTime = computed(() => {
	return dateInput.value !== '' && timeInput.value !== '';
});

const canLoadNewer = computed(() => {
	// Only show "Load newer" button if we have a target date and items in timeline
	return targetDate.value !== null && paginator.value?.items.value && paginator.value.items.value.length > 0;
});

function createPaginator(initialDate: number | null) {
	const newPaginator = markRaw(new Paginator('notes/hybrid-timeline', {
		computedParams: computed(() => ({
			withRenotes: withRenotes.value,
			withReplies: withReplies.value,
			withFiles: onlyFiles.value ? true : undefined,
		})),
		initialDate: initialDate,
		initialDirection: 'older',
		useShallowRef: true,
	}));
	return newPaginator;
}

function goToDateTime() {
	if (!isValidDateTime.value) return;

	const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return;

	targetDate.value = datetime.getTime();
	paginator.value = createPaginator(datetime.getTime());
	timelineKey.value++;
	currentNewestNoteId.value = null;
}

function goToNow() {
	targetDate.value = null;
	paginator.value = createPaginator(null);
	timelineKey.value++;
	currentNewestNoteId.value = null;
}

async function loadNewer() {
	if (!targetDate.value || !paginator.value || isLoadingNewer.value || !scrollContainer.value) return;

	isLoadingNewer.value = true;

	try {
		// Store the current scroll height before loading new notes
		const previousScrollHeight = scrollContainer.value.scrollHeight;
		const previousScrollTop = scrollContainer.value.scrollTop;

		// Fetch newer notes
		await paginator.value.fetchNewer();

		// Wait for DOM to update
		await nextTick();

		// Calculate the height of newly added content
		const newScrollHeight = scrollContainer.value.scrollHeight;
		const addedHeight = newScrollHeight - previousScrollHeight;

		// Adjust scroll position to maintain visual position
		// New notes are added at the top, so we need to scroll down by the added height
		scrollContainer.value.scrollTop = previousScrollTop + addedHeight;
	} catch (error) {
		console.error('Failed to load newer notes:', error);
	} finally {
		isLoadingNewer.value = false;
	}
}

function formatDateTime(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${year}/${month}/${day} ${hours}:${minutes}`;
}

const headerActions = computed(() => [{
	icon: 'ti ti-settings',
	text: 'Options',
	handler: () => {
		// TODO: Add timeline filter options if needed
	},
}]);

// Initialize paginator when it changes
watch(paginator, (newPaginator) => {
	if (newPaginator) {
		newPaginator.init();
	}
});

definePage(() => ({
	title: 'Time Machine',
	icon: 'ti ti-clock-bolt',
}));
</script>

<style lang="scss" module>
.controls {
	padding: var(--MI-margin);
	border-radius: var(--MI-radius);
}

.dateTimeSection {
	margin-bottom: 16px;
}

.label {
	font-weight: bold;
	margin-bottom: 8px;
}

.dateTimeInputs {
	display: flex;
	gap: 12px;
}

.buttonSection {
	display: flex;
	gap: 12px;
	margin-bottom: 12px;
}

.currentPosition {
	padding: 12px;
	background: var(--MI_THEME-accentedBg);
	border-radius: var(--MI-radius);
	color: var(--MI_THEME-accent);
	font-weight: bold;
	text-align: center;

	i {
		margin-right: 4px;
	}
}

.placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 64px 32px;
	text-align: center;
	color: var(--MI_THEME-fg);
	opacity: 0.7;
}

.placeholderIcon {
	font-size: 64px;
	margin-bottom: 16px;
	opacity: 0.5;
}

.placeholderText {
	font-size: 16px;
	line-height: 1.6;
}

.newerSection {
	display: flex;
	justify-content: center;
	margin-bottom: 12px;
}
</style>
