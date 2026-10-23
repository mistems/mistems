<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<XColumn :menu="menu" :column="column" :isStacked="isStacked" :refresher="loadNewer">
	<template #header>
		<i class="ti ti-clock-bolt"></i>
		<span style="margin-left: 8px;">{{ column.name || i18n.ts._deck._columns.timemachine }}</span>
	</template>

	<div :class="$style.container">
		<!-- パーミッションチェック -->
		<div v-if="!timemachineAvailable" :class="$style.placeholder">
			<MkInfo warn>{{ i18n.ts.timemachineNotAvailable }}</MkInfo>
		</div>

		<!-- 既存のコンテンツ -->
		<div v-else style="display: contents;">
			<!-- 日時選択コントロール -->
			<TimemachineControls
				v-if="showControls"
				v-model:timelineSource="timelineSource"
				v-model:dateInput="dateInput"
				v-model:timeInput="timeInput"
				@goToDateTime="goToDateTime"
				@goToDateTimeWithFusion="goToDateTimeWithFusion"
			/>

			<!-- タイムシフトプレイヤー -->
			<TimemachinePlayer
				v-if="isTimeshiftMode"
				v-model:playbackSpeed="playbackSpeed"
				:isTimeshiftPlaying="isTimeshiftPlaying"
				:playbackTime="playbackTime"
				:timeshiftStartTime="timeshiftStartTime"
				:timeshiftEndTime="timeshiftEndTime"
				:isTimefusionMode="isTimefusionMode"
				:isUserSeeking="isUserSeeking"
				@play="playTimeshift"
				@pause="pauseTimeshift"
				@stop="stopTimeshift"
				@toggleTimefusion="toggleTimefusion"
				@seekInput="onSeekInput"
				@seekChange="onSeekChange"
				@pauseOnSeek="pauseOnSeek"
				@resumeAfterSeek="resumeAfterSeek"
			/>

			<!-- Load Newerボタン -->
			<div v-if="targetDate !== null && canLoadNewer && !isTimeshiftMode" :class="$style.loadMore">
				<div :class="$style.loadMoreRow">
					<MkButton :disabled="isLoadingNewer" style="flex: 1;" @click="loadNewer">
						<i class="ti ti-arrow-up"></i> Load newer notes
					</MkButton>
					<MkButton @click="toggleControls">
						<i class="ti ti-clock-bolt"></i>
					</MkButton>
				</div>
				<div :class="$style.loadMoreRow">
					<MkButton primary style="flex: 1;" @click="startTimeshift">
						<i class="ti ti-player-play"></i> Timeshift
					</MkButton>
					<MkButton primary style="flex: 1;" @click="startTimefusion">
						<i class="ti ti-bolt"></i> Timefusion
					</MkButton>
				</div>
			</div>

			<!-- タイムライン表示 -->
			<div v-if="paginator" ref="scrollContainer" :class="$style.timeline">
				<MkTimemachineNoteTimeline
					ref="tlComponent"
					:key="timelineKey"
					:paginator="paginator!"
					:withControl="false"
					:pullToRefresh="true"
					:autoLoad="false"
				/>
			</div>
			<div v-else :class="$style.placeholder">
				<i class="ti ti-clock-bolt"></i>
				<p>Select a date and time to view the timeline</p>
			</div>
		</div>
	</div>
</XColumn>
</template>

<script lang="ts" setup>
import { ref, computed, provide, watch, onUnmounted, nextTick, markRaw } from 'vue';
import XColumn from './column.vue';
import type { Column } from '@/deck.js';
import { updateColumn } from '@/deck.js';
import TimemachineControls from '@/components/TimemachineControls.vue';
import TimemachinePlayer from '@/components/TimemachinePlayer.vue';
import MkTimemachineNoteTimeline from '@/components/MkTimemachineNoteTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { TimeshiftPaginator } from '@/utility/timeshiftPaginator.js';
import { store } from '@/store.js';
import * as os from '@/os.js';
import { useTimeshiftPlayback, useTimeshiftSeek, useTimeshiftComputed, useTimefusionStream, getEndpointForSource } from '@/composables/use-timemachine.js';
import { useTimemachinePage } from '@/composables/use-timemachine-page.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';
import { formatTimestamp } from '@/utility/timemachine-format.js';

const props = defineProps<{
	column: Column;
	isStacked: boolean;
}>();

// 絶対時刻表示を強制
provide('forceAbsoluteTime', true);

// タイムラインフィルター
const withRenotes = computed(() => store.r.tl.value.filter.withRenotes);
const withReplies = computed(() => store.r.tl.value.filter.withReplies);
const onlyFiles = computed(() => store.r.tl.value.filter.onlyFiles);

// 状態管理
const scrollContainer = ref<HTMLDivElement | null>(null);

// Use timemachine page composable
const {
	showControls,
	timelineSource,
	dateInput,
	timeInput,
	paginator,
	timelineKey,
	isLoadingNewer,
	targetDate,
	isValidDateTime,
	toggleControls,
	loadNewer,
} = useTimemachinePage({
	timelineFilters: {
		withRenotes,
		withReplies,
		onlyFiles,
	},
	scrollContainerRef: scrollContainer,
});

// カラムからの初期値を設定
const now = new Date();
timelineSource.value = props.column.timemachineTl ?? 'social';
dateInput.value = props.column.timemachineDate ??
	`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
timeInput.value = props.column.timemachineTime ??
	`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

// Timeshift mode - useTimeshiftPlayback composable
const {
	isTimeshiftPlaying,
	playbackSpeed,
	play: playTimeshift,
	pause: pauseTimeshift,
	stop: stopTimeshiftPlayback,
	cleanup: cleanupPlayback,
} = useTimeshiftPlayback(paginator, {
	onError: () => {
		stopTimeshift();
	},
});

// Timeshift seek - useTimeshiftSeek composable
const {
	isUserSeeking,
	onSeekInput,
	onSeekChange,
	pauseOnSeek,
	resumeAfterSeek,
} = useTimeshiftSeek(paginator, isTimeshiftPlaying, pauseTimeshift, playTimeshift);

// Timefusion mode - useTimefusionStream composable
const {
	setupStream: setupRealtimeStream,
	toggle: toggleTimefusion,
	cleanup: cleanupFusionStream,
} = useTimefusionStream(paginator, timelineSource);

// Paginator依存のcomputed - useTimeshiftComputed composable
const {
	isTimeshiftMode,
	playbackTime,
	timeshiftStartTime,
	timeshiftEndTime,
	isTimefusionMode,
	canLoadNewer,
} = useTimeshiftComputed(paginator);

// Functions

function createPaginator(initialDate: number): TimeshiftPaginator {
	const endpoint = getEndpointForSource(timelineSource.value);
	const newPaginator = markRaw(new TimeshiftPaginator(endpoint, {
		computedParams: computed(() => ({
			withRenotes: withRenotes.value,
			withReplies: withReplies.value,
			withFiles: onlyFiles.value ? true : undefined,
		})),
		initialDate,
		initialDirection: 'older',
	}));

	// PullToReflash用に、reloadの代わりに我々のloadNewer = fetchNew してスクロール位置を調整 する関数を詰める
	newPaginator.reload = loadNewer;
	return newPaginator;
}

function goToDateTime() {
	if (!isValidDateTime.value) return;

	let datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	let targetTimestamp = datetime.getTime();

	// ロールポリシーによる時刻制限をチェック
	if ($i) {
		// 最も新しい（最近の）制限時刻を計算
		let earliestAllowedTime = 0;

		// timemachineReachableFrom: 絶対時刻による制限
		if ($i.policies.timemachineReachableFrom > 0) {
			earliestAllowedTime = Math.max(earliestAllowedTime, $i.policies.timemachineReachableFrom);
		}

		// timemachineTravelableMaxDays: 相対的な日数による制限
		if ($i.policies.timemachineTravelableMaxDays > 0) {
			const maxDaysAgo = Date.now() - ($i.policies.timemachineTravelableMaxDays * 24 * 60 * 60 * 1000);
			earliestAllowedTime = Math.max(earliestAllowedTime, maxDaysAgo);
		}

		// 制限より古い時刻にアクセスしようとした場合、制限時刻に丸める
		if (earliestAllowedTime > 0 && targetTimestamp < earliestAllowedTime) {
			targetTimestamp = earliestAllowedTime;
			datetime = new Date(targetTimestamp);

			// 入力値を制限時刻に更新
			const year = datetime.getFullYear();
			const month = String(datetime.getMonth() + 1).padStart(2, '0');
			const day = String(datetime.getDate()).padStart(2, '0');
			const hours = String(datetime.getHours()).padStart(2, '0');
			const minutes = String(datetime.getMinutes()).padStart(2, '0');

			dateInput.value = `${year}-${month}-${day}`;
			timeInput.value = `${hours}:${minutes}`;

			// 通知を表示
			os.toast(String(i18n.ts.timemachineReachedLimit));
		}
	}

	paginator.value = createPaginator(targetTimestamp);
	timelineKey.value++;
	showControls.value = false;

	// カラム設定を保存
	updateColumn(props.column.id, {
		timemachineDate: dateInput.value,
		timemachineTime: timeInput.value,
	});
}

function goToDateTimeWithFusion() {
	if (!isValidDateTime.value) return;

	let datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	let targetTimestamp = datetime.getTime();

	// ロールポリシーによる時刻制限をチェック
	if ($i) {
		// 最も新しい（最近の）制限時刻を計算
		let earliestAllowedTime = 0;

		// timemachineReachableFrom: 絶対時刻による制限
		if ($i.policies.timemachineReachableFrom > 0) {
			earliestAllowedTime = Math.max(earliestAllowedTime, $i.policies.timemachineReachableFrom);
		}

		// timemachineTravelableMaxDays: 相対的な日数による制限
		if ($i.policies.timemachineTravelableMaxDays > 0) {
			const maxDaysAgo = Date.now() - ($i.policies.timemachineTravelableMaxDays * 24 * 60 * 60 * 1000);
			earliestAllowedTime = Math.max(earliestAllowedTime, maxDaysAgo);
		}

		// 制限より古い時刻にアクセスしようとした場合、制限時刻に丸める
		if (earliestAllowedTime > 0 && targetTimestamp < earliestAllowedTime) {
			targetTimestamp = earliestAllowedTime;
			datetime = new Date(targetTimestamp);

			// 入力値を制限時刻に更新
			const year = datetime.getFullYear();
			const month = String(datetime.getMonth() + 1).padStart(2, '0');
			const day = String(datetime.getDate()).padStart(2, '0');
			const hours = String(datetime.getHours()).padStart(2, '0');
			const minutes = String(datetime.getMinutes()).padStart(2, '0');

			dateInput.value = `${year}-${month}-${day}`;
			timeInput.value = `${hours}:${minutes}`;

			// 通知を表示
			os.toast(String(i18n.ts.timemachineReachedLimit));
		}
	}

	paginator.value = createPaginator(targetTimestamp);
	timelineKey.value++;
	showControls.value = false;

	// カラム設定を保存
	updateColumn(props.column.id, {
		timemachineDate: dateInput.value,
		timemachineTime: timeInput.value,
	});

	nextTick(() => {
		if (!paginator.value) return;
		paginator.value.startTimeshift(targetTimestamp);
		playTimeshift();

		nextTick(() => {
			if (!paginator.value) return;
			paginator.value.startTimefusion();
			setupRealtimeStream();
		});
	});
}

// toggleControls と loadNewer は composable から使用

// タイムシフトモードの準備（共通処理）
function prepareTimeshiftMode(): boolean {
	if (!targetDate.value || !paginator.value) return false;

	// タイムシフトを開始
	paginator.value.startTimeshift(targetDate.value);

	// タイムシフト再生を開始
	playTimeshift();

	return true;
}

function startTimeshift() {
	prepareTimeshiftMode();
}

function startTimefusion() {
	if (!prepareTimeshiftMode()) return;

	// タイムフュージョンを開始
	nextTick(() => {
		if (!paginator.value) return;
		paginator.value.startTimefusion();
		setupRealtimeStream();
	});
}

function stopTimeshift() {
	// playbackTimeをinputに戻す
	if (playbackTime.value !== null) {
		dateInput.value = formatTimestamp(playbackTime.value, 'date');
		timeInput.value = formatTimestamp(playbackTime.value, 'time');

		// カラムの設定を更新
		updateColumn(props.column.id, {
			timemachineDate: dateInput.value,
			timemachineTime: timeInput.value,
		});
	}

	stopTimeshiftPlayback();
	if (paginator.value) {
		paginator.value.stopTimeshift();
		paginator.value.stopTimefusion();
	}
	cleanupFusionStream();
	// showControls.value = true;
}

async function setTimelineSource() {
	const { canceled, result: src } = await os.select({
		title: i18n.ts.timeline,
		items: [
			{ value: 'home', label: i18n.ts._timelines.home },
			{ value: 'local', label: i18n.ts._timelines.local },
			{ value: 'social', label: i18n.ts._timelines.social },
			{ value: 'global', label: i18n.ts._timelines.global },
		],
		default: timelineSource.value,
	});

	if (canceled || src == null) return;

	timelineSource.value = src;
	updateColumn(props.column.id, { timemachineTl: src });

	// 既にタイムラインが表示されている場合は再作成
	if (paginator.value) {
		const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
		paginator.value = createPaginator(datetime.getTime());
		timelineKey.value++;
	}
}

// カラムメニュー
const menu = computed(() => [{
	icon: 'ti ti-settings',
	text: 'Timeline Source',
	action: setTimelineSource,
}, {
	icon: 'ti ti-clock',
	text: showControls.value ? 'Hide Controls' : 'Show Controls',
	action: () => {
		showControls.value = !showControls.value;
	},
}]);

// Watchers
watch(paginator, (newPaginator) => {
	if (newPaginator) newPaginator.init();
}, { immediate: true, flush: 'post' });

watch(timelineSource, (newSource) => {
	updateColumn(props.column.id, { timemachineTl: newSource });
});

// Cleanup
onUnmounted(() => {
	cleanupPlayback();
	cleanupFusionStream();
});
</script>

<style lang="scss" module>
.container {
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
}

.timeline {
	flex: 1;
	overflow-y: auto;
	min-height: 0;
}

.placeholder {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 32px;
	text-align: center;
	opacity: 0.6;

	i {
		font-size: 48px;
		margin-bottom: 12px;
	}

	p {
		font-size: 14px;
		line-height: 1.5;
	}
}

.loadMore {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
}

.loadMoreRow {
	display: flex;
	gap: 8px;
}
</style>
