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
		<!-- 日時選択カード -->
		<div v-if="showControls" :class="$style.card" class="_panel">
			<div :class="$style.cardHeader">
				<i class="ti ti-calendar-clock"></i>
				<span>Select Time</span>
			</div>
			<div :class="$style.cardBody">
				<MkSelect v-model="timelineSource" :items="timelineSourceItems">
					<template #label>Timeline Source</template>
				</MkSelect>
				<div :class="$style.dateTimeRow">
					<MkInput v-model="dateInput" type="date" :max="todayString" style="flex: 1;">
						<template #label>Date</template>
					</MkInput>
					<MkInput v-model="timeInput" type="time" style="flex: 1;">
						<template #label>Time</template>
					</MkInput>
					<MkButton primary @click="goToDateTime" :disabled="!isValidDateTime" style="align-self: flex-end;">
						<i class="ti ti-clock"></i> <MkTime :time="targetDate" :key="targetDate" />
					</MkButton>
				</div>
			
			</div>
		</div>

		<!-- タイムシフトプレイヤー -->
		<div v-if="isTimeshiftMode" :class="$style.player" class="_panel">
			<div :class="$style.playerHeader">
				<div :class="$style.playerTitle">
					<i class="ti ti-clock-play"></i>
					<span>Timeshift Playback</span>
				</div>
				<div :class="$style.currentTime">{{ formatTimeSec(playbackTime) }}</div>
			</div>

			<!-- シークバー -->
			<div :class="$style.seekBarSection">
				<div :class="$style.seekBarWrapper">
					<input
						ref="seekBarInput"
						type="range"
						:class="$style.seekBarInput"
						:min="timeshiftStartTime || 0"
						:max="timeshiftEndTime"
						:value="playbackTime || 0"
						@input="onSeekInput($event)"
						@change="onSeekChange($event)"
						@mousedown="pauseOnSeek"
						@mouseup="resumeAfterSeek"
						@touchstart="pauseOnSeek"
						@touchend="resumeAfterSeek"
					/>
				</div>
				<div :class="$style.timeRange">
					<span>{{ formatTime(timeshiftStartTime || 0) }}</span>
					<span>{{ formatTime(timeshiftEndTime) }}</span>
				</div>
			</div>

			<!-- コントロール -->
			<div :class="$style.controlsCard">
				<div :class="$style.controlsLeft">
					<MkButton v-if="!isTimeshiftPlaying" @click="playTimeshift" :class="$style.playBtn">
						<i class="ti ti-player-play"></i>
					</MkButton>
					<MkButton v-else @click="pauseTimeshift" :class="$style.playBtn">
						<i class="ti ti-player-pause"></i>
					</MkButton>
					<MkButton @click="stopTimeshift">
						<i class="ti ti-player-stop"></i>
					</MkButton>
				</div>
				<div :class="$style.controlsRight">
					<span :class="$style.speedLabelCard">Speed:</span>
					<MkSelect v-model="playbackSpeed" :items="playbackSpeedItems" @update:modelValue="onSpeedChange" small />
				</div>
			</div>
		</div>

		<!-- タイムライン -->
		<div v-if="paginator !== null" ref="scrollContainer" style="margin-top: var(--MI-margin); overflow-y: auto; height: 100vh;">
			<div v-if="targetDate !== null && canLoadNewer && !isTimeshiftMode" :class="$style.loadMore">
				<MkButton @click="loadNewer" :disabled="isLoadingNewer">
					<i class="ti ti-arrow-up"></i> Load newer notes
				</MkButton>
				<MkButton v-if="!isTimeshiftMode" primary @click="startTimeshift">
					<i class="ti ti-player-play"></i> Start Timeshift
			</MkButton>
			</div>
			<MkNotesTimeline ref="tlComponent" :key="timelineKey" :paginator="paginator" :withControl="false" :pullToRefresh="true"  />
		</div>
		<div v-else :class="$style.placeholder">
			<div :class="$style.placeholderIcon"><i class="ti ti-clock-bolt"></i></div>
			<div :class="$style.placeholderText">Select a date and time to view the timeline from that moment.</div>
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
import MkSelect from '@/components/MkSelect.vue';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import { definePage } from '@/page.js';
import { store } from '@/store.js';
import { Paginator } from '@/utility/paginator.js';
import MkTime from '@/components/global/MkTime.vue';
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

const timelineSourceItems = [
	{ value: 'home', label: 'Home Timeline' },
	{ value: 'local', label: 'Local Timeline' },
	{ value: 'social', label: 'Social Timeline' },
	{ value: 'global', label: 'Global Timeline' },
];

const playbackSpeedItems = [
	{ value: 0.5, label: '0.5x' },
	{ value: 1, label: '1x' },
	{ value: 2, label: '2x' },
	{ value: 5, label: '5x' },
	{ value: 10, label: '10x' },
	{ value: 20, label: '20x' },
	{ value: 50, label: '50x' },
	{ value: 100, label: '100x' },
];

const showControls = ref<boolean>(true);
const timelineSource = ref<'home' | 'local' | 'social' | 'global' | 'channel'>('social');
const dateInput = ref<string>(`${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`);
const timeInput = ref<string>(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
const targetDate = computed(() => {
	const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return Infinity;
	return datetime.getTime();
})
const timelineKey = ref<number>(0);
const paginator = ref<IPaginator<Misskey.entities.Note> | null>(null);
const isLoadingNewer = ref<boolean>(false);
const currentNewestNoteId = ref<string | null>(null);

// Timeshift mode
const isTimeshiftMode = ref<boolean>(false);
const isTimeshiftPlaying = ref<boolean>(false);
const playbackTime = ref<number | null>(null);
const playbackSpeed = ref<number>(1); // 1x, 2x, 0.5x, etc.
const timeshiftIntervalId = ref<number | null>(null);
const allFetchedNotes = ref<Misskey.entities.Note[]>([]);
const timeshiftStartTime = ref<number | null>(null);
const wasPlayingBeforeSeek = ref<boolean>(false);

const todayString = computed(() => {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
});

const isValidDateTime = computed(() => {
	if(typeof targetDate.value !== 'number')  return false
	return dateInput.value !== '' && timeInput.value !== '' && targetDate.value < now.getTime();
});

const canLoadNewer = computed(() => {
	// Only show "Load newer" button if we have a items in timeline
	return  paginator.value?.items.value && paginator.value.items.value.length > 0;
});

const displayedNotes = computed(() => {
	if (!isTimeshiftMode.value || playbackTime.value === null) {
		return paginator.value?.items.value || [];
	}

	// In timeshift mode, only show notes that were created before or at playback time
	return allFetchedNotes.value.filter(note => {
		const noteTime = new Date(note.createdAt).getTime();
		return noteTime <= playbackTime.value!;
	}).sort((a, b) => {
		// Sort by createdAt descending (newest first)
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});
});

const timeshiftEndTime = computed(() => {
	if (allFetchedNotes.value.length === 0) {
		return (timeshiftStartTime.value || 0) + 3600 * 1000; // Default to +1 hour
	}
	return Math.max(...allFetchedNotes.value.map(n => new Date(n.createdAt).getTime()));
});

function getEndpointForSource(source: 'home' | 'local' | 'social' | 'global' | 'channel'): string {
	switch (source) {
		case 'home':
			return 'notes/timeline';
		case 'local':
			return 'notes/local-timeline';
		case 'social':
			return 'notes/hybrid-timeline';
		case 'global':
			return 'notes/global-timeline';
		case 'channel':
			return 'notes/channel-timeline';
		default:
			return 'notes/timeline';
	}
}

function createPaginator(initialDate: number | null) {
	const endpoint = getEndpointForSource(timelineSource.value);
	const newPaginator = markRaw(new Paginator(endpoint, {
		computedParams: computed(() => ({
			withRenotes: withRenotes.value,
			withReplies: withReplies.value,
			withFiles: onlyFiles.value ? true : undefined,
		})),
		initialDate: initialDate,
		initialDirection: 'older',
		useShallowRef: true,
	}));
	// PullToReflash用に、reloadの代わりに我々のloadNewer = fetchNew してスクロール位置を調整 する関数を詰める
	newPaginator.reload = loadNewer
	return newPaginator;
}

function goToDateTime() {
	if (!isValidDateTime.value) return;

	const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return;

	paginator.value = createPaginator(datetime.getTime());
	timelineKey.value++;
	currentNewestNoteId.value = null;
	showControls.value = false;
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

		
		const now = new Date(paginator.value.items.value[0].createdAt)
		dateInput.value = `${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
		timeInput.value = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes()).toString().padStart(2, '0')}`;
	

	} catch (error) {
		console.error('Failed to load newer notes:', error);
	} finally {
		isLoadingNewer.value = false;
	}

}

function startTimeshift() {
	if (!targetDate.value || !paginator.value) return;

	isTimeshiftMode.value = true;
	timeshiftStartTime.value = targetDate.value;
	playbackTime.value = targetDate.value;

	// Collect all currently fetched notes
	allFetchedNotes.value = [...(paginator.value.items.value || [])];

	// Start playback
	playTimeshift();
}

function playTimeshift() {
	if (timeshiftIntervalId.value !== null) return;

	isTimeshiftPlaying.value = true;

	// Update playback time every 100ms
	timeshiftIntervalId.value = window.setInterval(() => {
		if (playbackTime.value === null) return;

		// Advance playback time by (100ms * playbackSpeed)
		const advancement = 100 * playbackSpeed.value;
		playbackTime.value += advancement;

		// Check if we need to prefetch more notes
		checkAndPrefetch();
	}, 100);
}

function pauseTimeshift() {
	if (timeshiftIntervalId.value !== null) {
		clearInterval(timeshiftIntervalId.value);
		timeshiftIntervalId.value = null;
	}
	isTimeshiftPlaying.value = false;
}

function stopTimeshift() {
	pauseTimeshift();
	isTimeshiftMode.value = false;
	playbackTime.value = null;
	allFetchedNotes.value = [];
	timeshiftStartTime.value = null;
}

function setPlaybackSpeed(speed: number) {
	const wasPlaying = isTimeshiftPlaying.value;
	if (wasPlaying) {
		pauseTimeshift();
	}
	playbackSpeed.value = speed;
	if (wasPlaying) {
		playTimeshift();
	}
}

function onSpeedChange(newSpeed: number) {
	setPlaybackSpeed(newSpeed);
}

async function checkAndPrefetch() {
	if (!playbackTime.value || !paginator.value) return;

	// Get the latest note time in our buffer
	const latestNoteTime = allFetchedNotes.value.length > 0
		? Math.max(...allFetchedNotes.value.map(n => new Date(n.createdAt).getTime()))
		: timeshiftStartTime.value || 0;

	
	// If playback time is approaching the end of buffer (within 30 seconds), fetch more
	const bufferThreshold = 30 * 1000; // 30 seconds
	if (playbackTime.value + bufferThreshold >= latestNoteTime) {
		try {
			const existingIds = new Set(allFetchedNotes.value.map(n => n.id));
			// Merge new notes into allFetchedNotes
			await paginator.value.fetchNewer();
			// 既存のnotesとfetchしたnotesが paginator.value.items.value には入っている
			const newNotes = paginator.value.items.value || [];
			
			const uniqueNewNotes = newNotes.filter(n => !existingIds.has(n.id));

			if (uniqueNewNotes.length === 0) {
				console.info('No more notes to prefetch');
				stopTimeshift()
			} else {
				// allFetchedNotes に追加するノートの重複検査をもう一度やる
				const existingIds = new Set(allFetchedNotes.value.map(n => n.id));
				const uniqueNewNotes = newNotes.filter(n => !existingIds.has(n.id));
				allFetchedNotes.value.push(...uniqueNewNotes);
				console.info(`Prefetched ${uniqueNewNotes.length} notes`);
			}
		} catch (error) {
			console.error('Failed to prefetch notes:', error);
			stopTimeshift()
		}
	}
}

const isUserSeeking = ref<boolean>(false);

function onSeekInput(event: Event) {
	const target = event.target as HTMLInputElement;
	playbackTime.value = parseInt(target.value, 10);
}

function onSeekChange(event: Event) {
	const target = event.target as HTMLInputElement;
	playbackTime.value = parseInt(target.value, 10);
}

function pauseOnSeek() {
	isUserSeeking.value = true;
	wasPlayingBeforeSeek.value = isTimeshiftPlaying.value;
	if (isTimeshiftPlaying.value) {
		pauseTimeshift();
	}
}

function resumeAfterSeek() {
	isUserSeeking.value = false;
	if (wasPlayingBeforeSeek.value) {
		playTimeshift();
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

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
}
function formatTimeSec(timestamp: number | null): string {
	if(timestamp === null) return ""
	const date = new Date(timestamp);
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const sec = String(date.getSeconds()).padStart(2, '0');
	return `${hours}:${minutes}:${sec}`;
}

const headerActions = computed(() => [{
	icon: 'ti ti-clock-bolt',
	text: showControls.value ? 'Hide Controls' : 'Show Controls',
	handler: () => {
		showControls.value = !showControls.value;
	},
}, {
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

// Update paginator items when in timeshift mode
watch([displayedNotes, isTimeshiftMode], ([notes, inTimeshiftMode]) => {
	if (inTimeshiftMode && paginator.value?.items.value) {
		// Update the paginator's items to show only the filtered notes
		paginator.value.items.value = notes;
	}
});

// Cleanup on unmount
watch(() => isTimeshiftMode.value, (newValue) => {
	if (!newValue) {
		pauseTimeshift();
	}
});

// Update seek bar input value when playback time changes (not during user seeking)
watch(playbackTime, (newTime) => {
	if (!isUserSeeking.value && newTime !== null) {
		// Force update the input element value
		const seekBarInput = document.querySelector('input[type="range"].seekBar') as HTMLInputElement;
		if (seekBarInput) {
			seekBarInput.value = String(newTime);
		}
	}
});

definePage(() => ({
	title: 'Time Machine',
	icon: 'ti ti-clock-bolt',
}));
</script>

<style lang="scss" module>
/* Placeholder styles */
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

/* Card Layout Styles */
.card {
	padding: 16px;
	margin-bottom: 12px;
}

.cardHeader {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: bold;
	font-size: 14px;
	margin-bottom: 12px;
	color: var(--MI_THEME-fg);
	opacity: 0.8;
}

.cardBody {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.dateTimeRow {
	display: flex;
	gap: 8px;
}

.statusCard {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 14px 16px;
	margin-bottom: 12px;
	background: var(--MI_THEME-accentedBg);
}

.statusLeft {
	display: flex;
	align-items: center;
	gap: 12px;
}

.statusLabel {
	font-size: 11px;
	opacity: 0.7;
	margin-bottom: 2px;
}

.statusTime {
	font-weight: bold;
	font-size: 15px;
	color: var(--MI_THEME-accent);
}

.statusRight {
	display: flex;
	gap: 8px;
}

.player {
	padding: 16px;
	margin-bottom: 12px;
}

.playerHeader {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 16px;
}

.playerTitle {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: bold;
}

.currentTime {
	font-family: monospace;
	font-size: 16px;
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.seekBarSection {
	margin-bottom: 12px;
}

.seekBarWrapper {
	margin-bottom: 4px;
}

.seekBarInput {
	width: 100%;
	height: 8px;
}

.timeRange {
	display: flex;
	justify-content: space-between;
	font-size: 11px;
	opacity: 0.6;
}

.controlsCard {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.controlsLeft {
	display: flex;
	gap: 6px;
}

.playBtn {
	min-width: 40px;
}

.controlsRight {
	display: flex;
	align-items: center;
	gap: 8px;
}

.speedLabelCard {
	font-size: 13px;
	font-weight: bold;
}

.loadMore {
	display: flex;
	justify-content: center;
	margin-bottom: 12px;
}
</style>
