<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader ref="pageWithHeaderRef" :actions="headerActions" :displayBackButton="true">
	<template #title>{{ i18n.ts.timeMachine }}</template>
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
				ref="controlsRef"
				v-model:timelineSource="timelineSource"
				v-model:dateInput="dateInput"
				v-model:timeInput="timeInput"
				:showModeButtons="!isTimeshiftMode"
				@goToDateTime="onGoToDateTime"
				@startTimeshift="startFromControls('timeshift')"
				@startTimefusion="startFromControls('timefusion')"
			/>

			<!-- タイムシフトプレイヤー -->
			<TimemachinePlayer
				v-if="isTimeshiftMode"
				ref="playerRef"
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
				@toggleTimefusion="onToggleTimefusion"
				@seekInput="onSeekInput"
				@seekChange="onSeekChange"
				@pauseOnSeek="pauseOnSeek"
				@resumeAfterSeek="resumeAfterSeek"
			/>

			<!-- タイムライン -->
			<div v-if="paginator !== null" ref="timelineAreaEl" :class="{ [$style.tourSample]: isTourSample }" style="margin-top: var(--MI-margin);">
				<div v-if="targetDate !== null && canLoadNewer && !isTimeshiftMode" :class="$style.loadMore">
					<div :class="$style.loadMoreRow">
						<MkButton ref="loadNewerButton" :disabled="isLoadingNewer" style="flex: 1;" @click="loadNewer">
							<i class="ti ti-arrow-up"></i> {{ i18n.ts._timemachine.loadNewer }}
						</MkButton>
						<MkButton :title="showControls ? i18n.ts._timemachine.hideControls : i18n.ts._timemachine.showControls" :aria-label="showControls ? i18n.ts._timemachine.hideControls : i18n.ts._timemachine.showControls" @click="toggleControls">
							<i class="ti ti-clock-bolt"></i>
						</MkButton>
					</div>
				</div>
				<MkTimemachineNoteTimeline ref="tlComponent" :key="timelineKey" :paginator="paginator!" :withControl="false" :pullToRefresh="true" :autoLoad="false"/>
			</div>
			<div v-else :class="$style.placeholder">
				<div :class="$style.placeholderIcon"><i class="ti ti-clock-bolt"></i></div>
				<div :class="$style.placeholderText">{{ i18n.ts._timemachine.selectDateTimeDescription }}</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts">
// 日時の指定から再生を始めると、URL の goto が変わってページが作り直される。
// 作り直されたページが再生を引き継げるよう、開始の予約をページの外に置く
let pendingStart: { mode: 'timeshift' | 'timefusion'; goto: string } | null = null;
</script>

<script lang="ts" setup>
import { computed, ref, watch, useTemplateRef, nextTick, provide, onMounted, onActivated, onDeactivated, onBeforeUnmount, markRaw } from 'vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkTimemachineNoteTimeline from '@/components/MkTimemachineNoteTimeline.vue';
import TimemachineControls from '@/components/TimemachineControls.vue';
import TimemachinePlayer from '@/components/TimemachinePlayer.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { definePage } from '@/page.js';
import { store } from '@/store.js';
import { TimeshiftPaginator, TimeshiftNoMoreItemsError } from '@/utility/timeshiftPaginator.js';
import { useRouter } from '@/router.js';
import { useTimeshiftPlayback, useTimeshiftSeek, useTimeshiftComputed, useTimefusionStream, getEndpointForSource } from '@/composables/use-timemachine.js';
import { useTimemachinePage } from '@/composables/use-timemachine-page.js';
import { timemachineAvailable } from '@/utility/check-permissions.js';
import { formatTimestamp, parseGotoParam } from '@/utility/timemachine-format.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { isTimemachineActive } from '@/timemachine-state.js';
import { startTour } from '@/utility/tour.js';
import type { TourStep } from '@/utility/tour.js';
import { TimemachineTourPaginator } from '@/utility/timemachine-tour-paginator.js';
import { closeTip } from '@/tips.js';

// Props（Nirax経由でクエリパラメータを受け取る）
const props = defineProps<{
	goto?: string;
}>();

const pageWithHeaderRef = useTemplateRef<InstanceType<typeof PageWithHeader>>('pageWithHeaderRef');
const controlsRef = useTemplateRef<InstanceType<typeof TimemachineControls>>('controlsRef');
const playerRef = useTemplateRef<InstanceType<typeof TimemachinePlayer>>('playerRef');
const loadNewerButton = useTemplateRef<InstanceType<typeof MkButton>>('loadNewerButton');
const timelineAreaEl = useTemplateRef<HTMLElement>('timelineAreaEl');

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
	onError: (error) => {
		// 新しいノートがもうないときは、黙って終わらずに理由を伝える
		if (error instanceof TimeshiftNoMoreItemsError) {
			os.toast(paginator.value?.hasNotesAfterStart() ? i18n.ts._timemachine.reachedLatestNote : i18n.ts._timemachine.noNotesToPlay);
		}
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
// タイムマシンページ表示中は投稿を制限する（タイムフュージョンモードを除く）
watch(isTimefusionMode, (fusion) => {
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

// 移動した日時 (ロールポリシーで丸めたあと) を返す。移動しなかったときは null を返す
function goToDateTime(): number | null {
	if (!isValidDateTime.value) return null;

	let datetime = new Date(`${dateInput.value}T${timeInput.value}`);
	if (isNaN(datetime.getTime())) return null;

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
	return targetTimestamp;
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

// ページはキャッシュされるので、作り直しのときも古いページはアンマウントされず非アクティブになるだけである
let active = true;

function onGoToDateTime() {
	// ツアー中は、本当のタイムラインの代わりにサンプルを読み込む
	if (isTourActive()) {
		showTourNormal(false);
		return;
	}
	pendingStart = null;
	goToDateTime();
}

// 日時の指定から直接再生を始める
function startFromControls(mode: 'timeshift' | 'timefusion') {
	if (isTourActive()) {
		showTourPlayback(mode === 'timefusion');
		return;
	}
	const timestamp = goToDateTime();
	if (timestamp == null) return;
	pendingStart = { mode, goto: formatGotoParam(timestamp) };
	startPendingAfterLoad();
}

// 予約された再生を、タイムラインを読み込み終えてから始める
async function startPendingAfterLoad() {
	const p = paginator.value;
	if (pendingStart == null || p == null) return;
	if (p.fetching.value) {
		await new Promise<void>((resolve) => {
			const stop = watch(p.fetching, (fetching) => {
				if (fetching) return;
				stop();
				resolve();
			});
		});
	}
	// ページが作り直された、または別の日時へ移動したときは、そちらに任せる
	if (!active || paginator.value !== p || pendingStart == null) return;
	const mode = pendingStart.mode;
	pendingStart = null;
	// ノートがなければ再生するものがない
	if (p.items.value.length === 0) return;
	if (mode === 'timefusion') {
		startTimefusion();
	} else {
		startTimeshift();
	}
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

// ---- 使い方ツアー ----
// ツアーの間は、ツアーの前のタイムラインをしまい、サンプルのノートを返す Paginator で各モードを実際に動かす。
// サンプルのノートは、ツアーの中で「移動」を押したときに初めて出す。ツアーが終わったら、始める前の状態に戻す

type StateBeforeTour = {
	paginator: TimeshiftPaginator | null;
	showControls: boolean;
	dateInput: string;
	timeInput: string;
	wasPlaying: boolean;
	wasFusion: boolean;
	playbackSpeed: number;
};

let stateBeforeTour: StateBeforeTour | null = null;
let tourBaseTime = 0;
let tourDemo: TimemachineTourPaginator | null = null;
// サンプルのノートを表示しているか
const isTourSample = ref(false);
let tourAbort: AbortController | null = null;
// 読み込み済みの Paginator。ツアーの前の Paginator に戻すときに、読み込み直さないようにする
const initializedPaginators = new WeakSet<TimeshiftPaginator>();

function isTourActive() {
	return stateBeforeTour != null;
}

// ツアーの前の状態をしまい、日時の指定だけの画面にする
function beginTourSession() {
	if (stateBeforeTour != null) return;

	stateBeforeTour = {
		paginator: paginator.value,
		showControls: showControls.value,
		dateInput: dateInput.value,
		timeInput: timeInput.value,
		wasPlaying: isTimeshiftPlaying.value,
		wasFusion: isTimefusionMode.value,
		playbackSpeed: playbackSpeed.value,
	};
	// ツアーの前のタイムラインは止めておく。いまのノートがサンプルに混ざらないよう、ストリームも切る
	pauseTimeshift();
	cleanupFusionStream();

	tourBaseTime = Math.floor((Date.now() - 60 * 60 * 1000) / 60000) * 60000;
	dateInput.value = formatTimestamp(tourBaseTime, 'date');
	timeInput.value = formatTimestamp(tourBaseTime, 'time');
	playbackSpeed.value = 1;
	paginator.value = null;
	showControls.value = true;
}

function disposeTourDemo() {
	const demo = tourDemo;
	if (demo == null) return;
	tourDemo = null;
	isTourSample.value = false;
	stopTimeshiftPlayback();
	demo.stopTimeshift();
	demo.stopTimefusion();
	demo.dispose();
}

function endTourSession() {
	const before = stateBeforeTour;
	if (before == null) return;
	stateBeforeTour = null;
	disposeTourDemo();

	dateInput.value = before.dateInput;
	timeInput.value = before.timeInput;
	showControls.value = before.showControls;
	playbackSpeed.value = before.playbackSpeed;
	paginator.value = before.paginator;
	timelineKey.value++;

	// ページを離れるときは、再生とストリームを再開しない (後片付けのあとに残ってしまう)
	if (active && before.paginator?.isTimeshiftMode.value) {
		if (before.wasFusion) setupRealtimeStream();
		if (before.wasPlaying) playTimeshift();
	}
}

// サンプルのタイムラインを読み込む (ツアーの中で「移動」を押したとき)
function ensureTourDemo(): TimemachineTourPaginator {
	if (tourDemo != null) return tourDemo;
	const demo = markRaw(new TimemachineTourPaginator(tourBaseTime));
	demo.init();
	initializedPaginators.add(demo);
	tourDemo = demo;
	isTourSample.value = true;
	paginator.value = demo;
	timelineKey.value++;
	return demo;
}

// 「移動」を押す前の画面 (日時の指定だけ) にする
async function showTourBeforeGo() {
	beginTourSession();
	disposeTourDemo();
	dateInput.value = formatTimestamp(tourBaseTime, 'date');
	timeInput.value = formatTimestamp(tourBaseTime, 'time');
	paginator.value = null;
	showControls.value = true;
	await nextTick();
}

// サンプルのタイムラインを通常モードで見せる
async function showTourNormal(controls: boolean) {
	beginTourSession();
	const demo = ensureTourDemo();
	if (demo.isTimeshiftMode.value) {
		stopTimeshiftPlayback();
		demo.stopTimeshift();
		demo.stopTimefusion();
	}
	showControls.value = controls;
	await nextTick();
}

// サンプルのタイムラインを再生して見せる
async function showTourPlayback(fusion: boolean) {
	beginTourSession();
	const demo = ensureTourDemo();
	if (!demo.isTimeshiftMode.value) {
		demo.startTimeshift(demo.baseTime);
	}
	if (!isTimeshiftPlaying.value) playTimeshift();
	if (fusion && !demo.isTimefusionMode.value) demo.startTimefusion();
	if (!fusion && demo.isTimefusionMode.value) demo.stopTimefusion();
	// プレイヤーが見やすいよう、日時の指定は隠す
	showControls.value = false;
	await nextTick();
}

// ツアー中は、いまのノートのストリームにつながず、サンプルのノートだけを流す
function onToggleTimefusion() {
	const p = paginator.value;
	if (p != null && p === tourDemo) {
		if (p.isTimefusionMode.value) {
			p.stopTimefusion();
		} else {
			p.startTimefusion();
		}
		return;
	}
	toggleTimefusion();
}

function findFirstNote(): HTMLElement | null {
	return timelineAreaEl.value?.querySelector<HTMLElement>('[data-scroll-anchor]') ?? null;
}

// 「新しいノートを読み込む」を押す前に、いちばん上にあったノート
let tourFirstNoteIdBeforeLoad: string | null = null;

async function showTourBeforeLoadNewer() {
	await showTourNormal(false);
	tourFirstNoteIdBeforeLoad = findFirstNote()?.dataset.scrollAnchor ?? null;
}

// 読み込む前にいちばん上にあったノートより上に並んでいる、読み込まれたノート
function findLoadedNewerNotes(): HTMLElement[] {
	const notes = Array.from(timelineAreaEl.value?.querySelectorAll<HTMLElement>('[data-scroll-anchor]') ?? []);
	const index = notes.findIndex((note) => note.dataset.scrollAnchor === tourFirstNoteIdBeforeLoad);
	return index > 0 ? notes.slice(0, index) : notes.slice(0, 1);
}

// 読み込む前にいちばん上にあったノートより上に、何件のノートが読み込まれたか
function countLoadedNewer(): number {
	const items = paginator.value?.items.value ?? [];
	const index = items.findIndex((item) => item.id === tourFirstNoteIdBeforeLoad);
	return Math.max(index, 0);
}

function findHelpButton(): HTMLElement | null {
	const root = pageWithHeaderRef.value?.$el as HTMLElement | undefined;
	return root?.querySelector('.ti-help-circle')?.closest('button') ?? null;
}

async function showTour() {
	if (!timemachineAvailable || tourAbort != null) return;
	tourAbort = new AbortController();

	const t = i18n.ts._timemachine._howToUse;
	// 操作を案内するステップは、案内したボタンを実際に押すと次へ進む
	const steps: TourStep[] = [
		{ element: () => controlsRef.value?.controlsEl, title: t.intro_title, description: t.intro_description, onEnter: showTourBeforeGo },
		{ element: () => controlsRef.value?.sourceAndDateEls, title: t.controls_title, description: t.controls_description, onEnter: showTourBeforeGo },
		{ element: () => controlsRef.value?.goButtonEl, title: t.go_title, description: t.go_description, onEnter: showTourBeforeGo, advanceOn: ['click'] },
		{ element: () => timelineAreaEl.value, title: t.normalMode_title, description: t.normalMode_description, onEnter: () => showTourNormal(false), interactive: true },
		{ element: () => loadNewerButton.value?.$el as HTMLElement | undefined, title: t.loadNewer_title, description: t.loadNewer_description, onEnter: showTourBeforeLoadNewer, advanceOn: ['click'] },
		// 読み込まれたノートをまとめて指す
		{ element: findLoadedNewerNotes, title: t.loadedNewer_title, description: () => i18n.tsx._timemachine._howToUse.loadedNewer_description({ n: countLoadedNewer() }), onEnter: () => showTourNormal(false), interactive: true },
		// 通常モードのまとめ。どこも指さずに、吹き出しだけを出す
		{ element: null, title: t.normalModeSummary_title, description: t.normalModeSummary_description, onEnter: () => showTourNormal(false) },
		{ element: () => controlsRef.value?.timeshiftButtonEl, title: t.modeButtons_title, description: t.modeButtons_description, onEnter: () => showTourNormal(true), advanceOn: ['click'] },
		{ element: null, title: t.timeshift_title, description: t.timeshift_description, onEnter: () => showTourPlayback(false) },
		// 再生中のタイムラインを指して、当時のノートが流れてくるところを見せる
		{ element: () => timelineAreaEl.value, title: t.timeshiftFlow_title, description: t.timeshiftFlow_description, onEnter: () => showTourPlayback(false) },
		// シークバーは説明を読むだけで次へ進める (試しに操作もできる)。再生コントロールは説明だけにする
		{ element: () => playerRef.value?.seekBarEl, title: t.seek_title, description: t.seek_description, onEnter: () => showTourPlayback(false), interactive: true },
		{ element: () => playerRef.value?.playbackEl, title: t.playback_title, description: t.playback_description, onEnter: () => showTourPlayback(false) },
		// 再生速度は、実際に変えると次へ進む
		{ element: () => playerRef.value?.speedEl, title: t.speed_title, description: t.speed_description, onEnter: () => showTourPlayback(false), advanceOnChange: () => playbackSpeed.value },
		{ element: () => playerRef.value?.fusionButtonEl, title: t.timefusion_title, description: t.timefusion_description, onEnter: () => showTourPlayback(false), advanceOn: ['click'] },
		// いまのノートが流れてくるタイムラインを指す
		{ element: () => timelineAreaEl.value, title: t.fusionLive_title, description: t.fusionLive_description, onEnter: () => showTourPlayback(true) },
		// スキップしたときも、最後にもう一度見る方法を案内する
		{ element: findHelpButton, title: t.reopen_title, description: t.reopen_description, onEnter: endTourSession },
	];

	const signal = tourAbort.signal;
	await startTour(steps, { skippable: true, doneLabel: i18n.ts.gotIt, scrollIntoView: true, signal });
	tourAbort = null;
	endTourSession();
	// 途中でページを離れたときは、次に開いたときにもう一度自動で始める
	if (!signal.aborted) closeTip('timemachine');
}

// ページを離れるときは、ツアーを閉じてすぐに元の状態へ戻す (後片付けより先に)
function abortTour() {
	if (tourAbort == null) return;
	tourAbort.abort();
	endTourSession();
}

const headerActions = computed(() => timemachineAvailable ? [{
	icon: 'ti ti-clock-bolt',
	text: showControls.value ? i18n.ts._timemachine.hideControls : i18n.ts._timemachine.showControls,
	handler: () => {
		showControls.value = !showControls.value;
	},
}, {
	icon: 'ti ti-help-circle',
	text: i18n.ts._timemachine.showHowToUse,
	handler: showTour,
}] : []);

// Initialize paginator when it changes
watch(paginator, (newPaginator) => {
	if (newPaginator && !initializedPaginators.has(newPaginator)) {
		initializedPaginators.add(newPaginator);
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
	// タイムマシンページがマウントされたら、グローバルstateを初期化
	// （タイムフュージョンモードでない限りtrue）
	isTimemachineActive.value = !isTimefusionMode.value;

	if (pendingStart != null && pendingStart.goto !== props.goto) pendingStart = null;

	if (props.goto) {
		const parsed = parseGotoParam(props.goto);
		if (parsed) {
			// 日付と時刻をセット
			dateInput.value = parsed.dateInput;
			timeInput.value = parsed.timeInput;

			// 自動的にタイムマシンを起動
			nextTick(() => {
				goToDateTime();
				startPendingAfterLoad();
			});
		}
	}

	// 初めて開いたときは、使い方ツアーを自動で始める
	if (timemachineAvailable && !store.s.tips.timemachine && pendingStart == null) {
		nextTick(() => {
			showTour();
		});
	}
});

// ページがアクティブになった時（ルーターキャッシュから復帰した時）
onActivated(() => {
	active = true;

	// タイムマシンページがアクティブになったら、グローバルstateを設定
	isTimemachineActive.value = !isTimefusionMode.value;
});

// ページが非アクティブになった時（別のページに遷移した時）
onDeactivated(() => {
	active = false;
	abortTour();

	// グローバルstateをリセット
	isTimemachineActive.value = false;
});

// Cleanup on unmount
onBeforeUnmount(() => {
	active = false;
	abortTour();

	// タイムシフト再生のクリーンアップ
	cleanupPlayback();

	// タイムフュージョンストリームのクリーンアップ
	cleanupFusionStream();

	// グローバルstateをリセット
	isTimemachineActive.value = false;
});

definePage(() => ({
	title: i18n.ts.timeMachine,
	icon: 'ti ti-clock-bolt',
}));
</script>

<style lang="scss" module>
// サンプルのノートは押しても API でエラーになるので、押せないようにする。
// スクロールは、下にあるタイムラインに届くのでそのままできる
.tourSample [data-scroll-anchor] {
	pointer-events: none;
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
