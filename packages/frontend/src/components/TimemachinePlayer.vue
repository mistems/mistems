<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.player" class="_panel">
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
				@input="handleSeekInput($event)"
				@change="handleSeekChange($event)"
				@mousedown="handlePauseOnSeek"
				@mouseup="handleResumeAfterSeek"
				@touchstart="handlePauseOnSeek"
				@touchend="handleResumeAfterSeek"
			/>
		</div>
		<div :class="$style.timeRange">
			<span>{{ formatTime(timeshiftStartTime || 0) }}</span>
			<span>{{ formatTime(timeshiftEndTime) }}</span>
		</div>
	</div>

	<!-- コントロール -->
	<div :class="$style.controlsCard">
		<div :class="$style.controlsRow">
			<MkButton v-if="!isTimeshiftPlaying" @click="$emit('play')" :class="$style.playBtn">
				<i class="ti ti-player-play"></i>
			</MkButton>
			<MkButton v-else @click="$emit('pause')" :class="$style.playBtn">
				<i class="ti ti-player-pause"></i>
			</MkButton>
			<MkButton @click="$emit('stop')" :class="$style.playBtn">
				<i class="ti ti-player-stop"></i>
			</MkButton>
			<!-- タイムフュージョン切り替えボタン -->
			<MkButton
				@click="$emit('toggleTimefusion')"
				:class="[$style.fusionButton, { [$style.active]: isTimefusionMode }]"
				:title="isTimefusionMode ? 'タイムフュージョンモードを無効化' : 'タイムフュージョンモードを有効化'"
			>
				<i class="ti ti-bolt"></i>
				{{ isTimefusionMode ? 'フュージョン中' : 'フュージョン' }}
			</MkButton>
		</div>
		<div :class="$style.controlsRow">
			<span :class="$style.speedLabelCard">Speed:</span>
			<MkSelect v-model="localPlaybackSpeed" :items="playbackSpeedItems" small />
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';

const props = defineProps<{
	isTimeshiftPlaying: boolean;
	playbackSpeed: number;
	playbackTime: number | null;
	timeshiftStartTime: number | null;
	timeshiftEndTime: number;
	isTimefusionMode: boolean;
	isUserSeeking: boolean;
}>();

const emit = defineEmits<{
	'update:playbackSpeed': [value: number];
	'play': [];
	'pause': [];
	'stop': [];
	'toggleTimefusion': [];
	'seekInput': [value: number];
	'seekChange': [value: number];
	'pauseOnSeek': [];
	'resumeAfterSeek': [];
}>();

const seekBarInput = useTemplateRef<HTMLInputElement>('seekBarInput');

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

const localPlaybackSpeed = computed({
	get: () => props.playbackSpeed,
	set: (value) => emit('update:playbackSpeed', value),
});

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
}

function formatTimeSec(timestamp: number | null): string {
	if (timestamp === null) return '';
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const sec = String(date.getSeconds()).padStart(2, '0');
	return `${year}/${month}/${day} ${hours}:${minutes}:${sec}`;
}

function handleSeekInput(event: Event) {
	const target = event.target as HTMLInputElement;
	emit('seekInput', parseInt(target.value, 10));
}

function handleSeekChange(event: Event) {
	const target = event.target as HTMLInputElement;
	emit('seekChange', parseInt(target.value, 10));
}

function handlePauseOnSeek() {
	emit('pauseOnSeek');
}

function handleResumeAfterSeek() {
	emit('resumeAfterSeek');
}

// Update seek bar input value when playback time changes (not during user seeking)
watch(() => props.playbackTime, (newTime) => {
	if (!props.isUserSeeking && newTime !== null && seekBarInput.value) {
		seekBarInput.value.value = String(newTime);
	}
});
</script>

<style lang="scss" module>
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
	flex-direction: column;
	gap: 8px;
}

.controlsRow {
	display: flex;
	align-items: center;
	gap: 6px;
}

.playBtn {
	min-width: 40px;
}

.speedLabelCard {
	font-size: 13px;
	font-weight: bold;
}

.fusionButton {
	&.active {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
	}
}
</style>
