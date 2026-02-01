<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader ref="pageWithHeaderRef" :actions="headerActions" :displayBackButton="true">
	<template #title>Time Machine</template>
	<template #icon><i class="ti ti-clock-bolt"></i></template>

	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<!-- パーミッションチェック -->
		<div v-if="!timemachineAvailable">
			<MkInfo warn>{{ i18n.ts.timemachineNotAvailable }}</MkInfo>
		</div>

		<!-- 既存のコンテンツ -->
		<div v-else>
			<!-- 日時選択カード -->
			<TimemachineControls
				v-if="showControls"
				v-model:timelineSource="timelineSource"
				v-model:dateInput="dateInput"
				v-model:timeInput="timeInput"
				@goToDateTime="goToDateTime"
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

			<!-- タイムライン -->
			<div v-if="paginator !== null" style="margin-top: var(--MI-margin);">
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
						<MkButton v-if="!isTimeshiftMode" primary style="flex: 1;" @click="startTimeshift">
							<i class="ti ti-player-play"></i> Start Timeshift
						</MkButton>
						<MkButton v-if="!isTimeshiftMode" primary style="flex: 1;" @click="startTimefusion">
							<i class="ti ti-bolt"></i> Start Timefusion
						</MkButton>
					</div>
				</div>
				<MkTimemachineNoteTimeline ref="tlComponent" :key="timelineKey" :paginator="paginator!" :withControl="false" :pullToRefresh="true" :autoLoad="false"/>
			</div>
			<div v-else :class="$style.placeholder">
				<div :class="$style.placeholderIcon"><i class="ti ti-clock-bolt"></i></div>
				<div :class="$style.placeholderText">Select a date and time to view the timeline from that moment.</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, useTemplateRef, nextTick, provide, onMounted, onBeforeUnmount, markRaw } from 'vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkTimemachineNoteTimeline from '@/components/MkTimemachineNoteTimeline.vue';
import TimemachineControls from '@/components/TimemachineControls.vue';
import TimemachinePlayer from '@/components/TimemachinePlayer.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { definePage } from '@/page.js';
import { store } from '@/store.js';
import { TimeshiftPaginator } from '@/utility/timeshiftPaginator.js';
import { useRouter } from '@/router.js';
import { useTimeshiftPlayback, useTimeshiftSeek, useTimeshiftComputed, useTimefusionStream, getEndpointForSource } from '@/composables/use-timemachine.js';
import { useTimemachinePage } from '@/composables/use-timemachine-page.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';
import { formatTimestamp, parseGotoParam } from '@/utility/timemachine-format.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { isTimemachineActive } from '@/timemachine-state.js';

// Props（Nirax経由でクエリパラメータを受け取る）
const props = defineProps<{
	goto?: string;
}>();

const pageWithHeaderRef = useTemplateRef<InstanceType<typeof PageWithHeader>>('pageWithHeaderRef');

// ルーターインスタンスを取得（ウィンドウ内では windowRouter、外では mainRouter）
const router = useRouter();

// タイムマシンページでは絶対時刻を表示するコンテキストを提供
provide('forceAbsoluteTime', true);

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

// Use timemachine page composable
const scrollContainerRef = computed(() => pageWithHeaderRef.value?.$el as HTMLElement | null);

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
	toggleControls: toggleControlsBase,
	loadNewer: loadNewerBase,
} = useTimemachinePage({
	timelineFilters: {
		withRenotes,
		withReplies,
		onlyFiles,
	},
	scrollContainerRef,
});

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

// タイムマシンのグローバルstateを更新
// タイムシフト中かつタイムフュージョンでない場合、投稿を制限する
watch([isTimeshiftMode, isTimefusionMode], ([fusion]) => {
	isTimemachineActive.value = !fusion;
}, { immediate: true, flush: 'post' });

function createPaginator(initialDate: number | null): TimeshiftPaginator {
	const endpoint = getEndpointForSource(timelineSource.value);
	const newPaginator = markRaw(new TimeshiftPaginator(endpoint, {
		computedParams: computed(() => ({
			withRenotes: withRenotes.value,
			withReplies: withReplies.value,
			withFiles: onlyFiles.value ? true : undefined,
		})),
		initialDate: initialDate,
		initialDirection: 'older',
	}));
	// PullToReflash用に、reloadの代わりに我々のloadNewer = fetchNew してスクロール位置を調整 する関数を詰める
	newPaginator.reload = loadNewer;
	return newPaginator;
}

function goToDateTime() {
	if (!isValidDateTime.value) return;

	let datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return;

	// ロールポリシーによる時刻制限をチェック
	let targetTimestamp = datetime.getTime();

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

	// URLのgotoパラメータを更新
	const gotoParam = formatGotoParam(targetTimestamp);
	router.replace('/timemachine', {
		query: { goto: gotoParam },
	});

	paginator.value = createPaginator(targetTimestamp);
	timelineKey.value++;
	showControls.value = false;
}

// コントロールパネルの表示/非表示を切り替え（composableから使用）
const toggleControls = toggleControlsBase;

// 新しいノートを読み込む（composableから使用）
const loadNewer = loadNewerBase;

// タイムシフトモードの準備（共通処理）
function prepareTimeshiftMode(): boolean {
	if (!targetDate.value || !paginator.value) return false;

	// playbackTimeが進行中ならそれを使用、なければtargetDateを使用
	const timestampToUse = playbackTime.value ?? targetDate.value;

	// URLのgotoパラメータを更新
	const gotoParam = formatGotoParam(timestampToUse);
	router.replace('/timemachine', {
		query: { goto: gotoParam },
	});

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
	}

	stopTimeshiftPlayback();
	if (paginator.value) {
		paginator.value.stopTimeshift();
		paginator.value.stopTimefusion();
	}

	cleanupFusionStream();

	// コントロールパネルを表示
	// showControls.value = true;
}

// checkAndPrefetch is now handled by TimeshiftPaginator internally

function formatGotoParam(timestamp: number): string {
	return formatTimestamp(timestamp, 'goto');
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

// Cleanup on unmount
watch(isTimeshiftMode, (newValue) => {
	if (!newValue) {
		pauseTimeshift();
	}
});

// Nirax経由でクエリパラメータから日時を取得してセット
onMounted(() => {
	if (props.goto) {
		const parsed = parseGotoParam(props.goto);
		if (parsed) {
			// 日付と時刻をセット
			dateInput.value = parsed.dateInput;
			timeInput.value = parsed.timeInput;

			// 自動的にタイムマシンを起動
			nextTick(() => {
				goToDateTime();
			});
		}
	}
});

// Cleanup on unmount
onBeforeUnmount(() => {
	// タイムシフト再生のクリーンアップ
	cleanupPlayback();

	// タイムフュージョンストリームのクリーンアップ
	cleanupFusionStream();

	// グローバルstateをリセット
	isTimemachineActive.value = false;
});

definePage(() => ({
	title: 'Time Machine',
	icon: 'ti ti-clock-bolt',
}));
</script>

<style lang="scss" module>
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

.loadMore {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 12px;
}

.loadMoreRow {
	display: flex;
	gap: 8px;
}
</style>
