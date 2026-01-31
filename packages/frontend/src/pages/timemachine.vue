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
				:isTimeshiftPlaying="isTimeshiftPlaying"
				v-model:playbackSpeed="playbackSpeed"
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
						<MkButton @click="loadNewer" :disabled="isLoadingNewer" style="flex: 1;">
							<i class="ti ti-arrow-up"></i> Load newer notes
						</MkButton>
						<MkButton @click="toggleControls">
							<i class="ti ti-settings"></i>
						</MkButton>
					</div>
					<div :class="$style.loadMoreRow">
						<MkButton v-if="!isTimeshiftMode" primary @click="startTimeshift" style="flex: 1;">
							<i class="ti ti-player-play"></i> Start Timeshift
						</MkButton>
						<MkButton v-if="!isTimeshiftMode" primary @click="startTimefusion" style="flex: 1;">
							<i class="ti ti-bolt"></i> Start Timefusion
						</MkButton>
					</div>
				</div>
				<MkTimemachineNoteTimeline ref="tlComponent" :key="timelineKey" :paginator="paginator!" :withControl="false" :pullToRefresh="true" :autoLoad="false" />
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
import { computed, ref, markRaw, watch, useTemplateRef, nextTick, provide, onMounted, onBeforeUnmount, type Ref } from 'vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkTimemachineNoteTimeline from '@/components/MkTimemachineNoteTimeline.vue';
import TimemachineControls from '@/components/TimemachineControls.vue';
import TimemachinePlayer from '@/components/TimemachinePlayer.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { definePage } from '@/page.js';
import { store } from '@/store.js';
import { TimeshiftPaginator } from '@/utility/timeshiftPaginator.js';
import { mainRouter } from '@/router.js';
import { getEndpointForSource, useTimeshiftPlayback, useTimeshiftSeek, useTimeshiftComputed, useTimefusionStream } from '@/composables/use-timemachine.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

// Props（Nirax経由でクエリパラメータを受け取る）
const props = defineProps<{
	goto?: string;
}>();

const pageWithHeaderRef = useTemplateRef<InstanceType<typeof PageWithHeader>>('pageWithHeaderRef');

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

// Date/time input
const now = new Date();

const showControls = ref<boolean>(true);
const timelineSource = ref<'home' | 'local' | 'social' | 'global'>('social');
const dateInput = ref<string>(`${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`);
const timeInput = ref<string>(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
const targetDate = computed(() => {
	const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return Infinity;
	return datetime.getTime();
})
const timelineKey = ref<number>(0);
const paginator: Ref<TimeshiftPaginator | null> = ref(null);
const isLoadingNewer = ref<boolean>(false);
const currentNewestNoteId = ref<string | null>(null);

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

const isValidDateTime = computed(() => {
	if(typeof targetDate.value !== 'number')  return false
	return dateInput.value !== '' && timeInput.value !== '' && targetDate.value < now.getTime();
});


// Paginator依存のcomputed - useTimeshiftComputed composable
const {
	isTimeshiftMode,
	playbackTime,
	timeshiftStartTime,
	timeshiftEndTime,
	isTimefusionMode,
	canLoadNewer,
} = useTimeshiftComputed(paginator);


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
	mainRouter.replace('/timemachine', {
		query: { goto: gotoParam },
	});

	paginator.value = createPaginator(targetTimestamp);
	timelineKey.value++;
	currentNewestNoteId.value = null;
	showControls.value = false;
}

// コントロールパネルの表示/非表示を切り替え
function toggleControls() {
	showControls.value = !showControls.value;
}

async function loadNewer() {
	const scrollContainer = pageWithHeaderRef.value?.$el as HTMLElement | undefined;
	if (!targetDate.value || !paginator.value || isLoadingNewer.value || !scrollContainer) return;

	isLoadingNewer.value = true;

	try {
		// 最初のノート要素を取得（追跡用）
		const firstNoteElement = scrollContainer.querySelector('[data-scroll-anchor]') as HTMLElement;
		const scrollContainerRect = scrollContainer.getBoundingClientRect();
		const firstNoteRect = firstNoteElement?.getBoundingClientRect();
		// scrollContainerからの相対位置を使用
		const firstNoteOffsetFromTop = firstNoteRect && scrollContainerRect ? firstNoteRect.y - scrollContainerRect.y : null;

		// Fetch newer notes
		await paginator.value.fetchNewer();

		// Wait for DOM to update
		await nextTick();

		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

		// 最初のノート要素の位置を元に戻す
		if (firstNoteElement && firstNoteOffsetFromTop !== null && scrollContainerRect) {
			const currentScrollContainerRect = scrollContainer.getBoundingClientRect();
			const currentNoteRect = firstNoteElement.getBoundingClientRect();
			const currentOffsetFromTop = currentNoteRect.y - currentScrollContainerRect.y;
			// 修正: 最初のノートを元の位置に戻すために必要なスクロール量を計算
			// 新しいノートが上に追加されると、元のノートは下に移動する
			// 元の位置に戻すには、現在の位置 - 元の位置 = 必要なスクロール量（正の値）
			const scrollAdjustment = currentOffsetFromTop - firstNoteOffsetFromTop;

			// scrollTopを増やして、元のノートを元の位置に戻す
			scrollContainer.scrollTop += scrollAdjustment;
		}


		const p = paginator.value as TimeshiftPaginator | null;
		if (p) {
			const items = p.items.value;
			if (items && items.length > 0) {
				const now = new Date(items[0].createdAt);
				dateInput.value = `${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
				timeInput.value = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes()).toString().padStart(2, '0')}`;
			}
		}

	} catch (error) {
		// Error handling
	} finally {
		isLoadingNewer.value = false;
	}

}

function startTimeshift() {
	if (!targetDate.value || !paginator.value) return;

	// playbackTimeが進行中ならそれを使用、なければtargetDateを使用
	const timestampToUse = playbackTime.value ?? targetDate.value;

	// URLのgotoパラメータを更新
	const gotoParam = formatGotoParam(timestampToUse);
	mainRouter.replace('/timemachine', {
		query: { goto: gotoParam },
	});

	// Paginator のメソッドを呼び出すだけ
	paginator.value.startTimeshift(targetDate.value);

	// Start playback
	playTimeshift();
}

function startTimefusion() {
	if (!targetDate.value || !paginator.value) return;

	// playbackTimeが進行中ならそれを使用、なければtargetDateを使用
	const timestampToUse = playbackTime.value ?? targetDate.value;

	// URLのgotoパラメータを更新
	const gotoParam = formatGotoParam(timestampToUse);
	mainRouter.replace('/timemachine', {
		query: { goto: gotoParam },
	});

	// タイムシフトを開始
	paginator.value.startTimeshift(targetDate.value);

	// タイムシフト再生を開始
	playTimeshift();

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
		const date = new Date(playbackTime.value);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');

		dateInput.value = `${year}-${month}-${day}`;
		timeInput.value = `${hours}:${minutes}`;
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
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
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
	if (props.goto && /^\d{14}$/.test(props.goto)) {
		// フォーマット: YYYYMMDDHHMMSS (14桁)
		const year = props.goto.substring(0, 4);
		const month = props.goto.substring(4, 6);
		const day = props.goto.substring(6, 8);
		const hours = props.goto.substring(8, 10);
		const minutes = props.goto.substring(10, 12);

		// 日付と時刻をセット
		dateInput.value = `${year}-${month}-${day}`;
		timeInput.value = `${hours}:${minutes}`;

		// 自動的にタイムマシンを起動
		nextTick(() => {
			goToDateTime();
		});
	}
});

// Cleanup on unmount
onBeforeUnmount(() => {
	// タイムシフト再生のクリーンアップ
	cleanupPlayback();

	// タイムフュージョンストリームのクリーンアップ
	cleanupFusionStream();
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
