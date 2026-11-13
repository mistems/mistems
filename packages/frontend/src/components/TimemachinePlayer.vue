<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkFolder :defaultOpen="true" :class="$style.player">
	<template #icon>
		<i class="ti ti-clock-play"></i>
	</template>
	<template #label>
		{{ i18n.ts._timemachine.nowPlaying }}
	</template>
	<template #suffix>
		<span :class="$style.currentTime">{{ formatTimeSec(playbackTime) }}</span>
	</template>

	<!-- シークバー -->
	<div ref="seekBarEl" :class="$style.seekBarSection">
		<div :class="$style.seekBarWrapper">
			<input
				ref="seekBarInput"
				type="range"
				:aria-label="i18n.ts._timemachine.seekBar"
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
		<div ref="playbackEl" :class="$style.controlsRow">
			<MkButton v-if="!isTimeshiftPlaying" :class="$style.playBtn" :title="i18n.ts._timemachine.play" :aria-label="i18n.ts._timemachine.play" @click="$emit('play')">
				<i class="ti ti-player-play"></i>
			</MkButton>
			<MkButton v-else :class="$style.playBtn" :title="i18n.ts._timemachine.pause" :aria-label="i18n.ts._timemachine.pause" @click="$emit('pause')">
				<i class="ti ti-player-pause"></i>
			</MkButton>
			<MkButton :class="$style.playBtn" :title="i18n.ts._timemachine.stop" :aria-label="i18n.ts._timemachine.stop" @click="$emit('stop')">
				<i class="ti ti-player-stop"></i>
			</MkButton>
		</div>
		<div :class="$style.controlsRow">
			<!-- タイムフュージョン切り替えボタン -->
			<MkButton
				ref="fusionButton"
				:class="[$style.fusionButton, { [$style.active]: isTimefusionMode }]"
				:title="isTimefusionMode ? i18n.ts._timemachine.disableTimefusion : i18n.ts._timemachine.enableTimefusion"
				@click="$emit('toggleTimefusion')"
			>
				<i class="ti ti-bolt"></i>
				{{ isTimefusionMode ? i18n.ts._timemachine.fusionActive : i18n.ts._timemachine.fusion }}
			</MkButton>
			<div ref="speedEl" :class="$style.speedControl">
				<MkSelect v-model="localPlaybackSpeed" :items="playbackSpeedItems" small/>
			</div>
		</div>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkFolder from '@/components/MkFolder.vue';
import { formatTimestamp } from '@/utility/timemachine-format.js';
import { i18n } from '@/i18n.js';

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

// 使い方ツアーで指し示すための要素
const seekBarEl = useTemplateRef<HTMLElement>('seekBarEl');
const playbackEl = useTemplateRef<HTMLElement>('playbackEl');
const speedEl = useTemplateRef<HTMLElement>('speedEl');

const fusionButton = useTemplateRef<InstanceType<typeof MkButton>>('fusionButton');
const fusionButtonEl = computed(() => fusionButton.value?.$el as HTMLElement | undefined);

defineExpose({ seekBarEl, playbackEl, speedEl, fusionButtonEl });

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
	return formatTimestamp(timestamp, 'time');
}

function formatTimeSec(timestamp: number | null): string {
	if (timestamp === null) return '';
	return formatTimestamp(timestamp, 'time-sec');
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
	margin-bottom: 12px;

	> * {
		padding: 16px;
	}
}

.currentTime {
	font-family: monospace;
	font-size: 12px;
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.seekBarSection {
	margin-bottom: 12px;
	padding-top: 0 !important;
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

.speedControl {
	margin-left: auto;
}

.fusionButton {
	&.active {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
	}
}
</style>
