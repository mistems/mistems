/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, computed, markRaw, nextTick } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import { TimeshiftPaginator } from '@/utility/timeshiftPaginator.js';
import { getEndpointForSource } from '@/composables/use-timemachine.js';
import { formatTimestamp } from '@/utility/timemachine-format.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';

/**
 * タイムマシンページの共通ロジックを提供するComposable
 */
export function useTimemachinePage(options: {
	timelineFilters: {
		withRenotes: ComputedRef<boolean>;
		withReplies: ComputedRef<boolean>;
		onlyFiles: ComputedRef<boolean>;
	};
	onPaginatorCreate?: (paginator: TimeshiftPaginator) => void;
	scrollContainerRef?: Ref<HTMLElement | null>;
}) {
	const now = new Date();
	const showControls = ref(true);
	const timelineSource = ref<'home' | 'local' | 'social' | 'global'>('social');
	const dateInput = ref<string>(
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
	);
	const timeInput = ref<string>(
		`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
	);
	const paginator: Ref<TimeshiftPaginator | null> = ref(null);
	const timelineKey = ref(0);
	const isLoadingNewer = ref(false);

	// Computed
	const targetDate = computed(() => {
		const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
		if (isNaN(datetime.getTime())) return Infinity;
		return datetime.getTime();
	});

	const isValidDateTime = computed(() => {
		return typeof targetDate.value === 'number' && targetDate.value < Date.now();
	});

	/**
	 * Paginatorを作成
	 */
	function createPaginator(initialDate: number): TimeshiftPaginator {
		const endpoint = getEndpointForSource(timelineSource.value);
		const newPaginator = markRaw(new TimeshiftPaginator(endpoint, {
			computedParams: computed(() => ({
				withRenotes: options.timelineFilters.withRenotes.value,
				withReplies: options.timelineFilters.withReplies.value,
				withFiles: options.timelineFilters.onlyFiles.value ? true : undefined,
			})),
			initialDate,
			initialDirection: 'older',
		}));

		// PullToRefresh用に、reloadの代わりにloadNewerを詰める
		newPaginator.reload = loadNewer;

		if (options.onPaginatorCreate) {
			options.onPaginatorCreate(newPaginator);
		}

		return newPaginator;
	}

	/**
	 * ロールポリシーによる時刻制限をチェック
	 */
	function checkTimestampPolicy(timestamp: number): { timestamp: number; updated: boolean } {
		if (!$i) return { timestamp, updated: false };

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
		if (earliestAllowedTime > 0 && timestamp < earliestAllowedTime) {
			return { timestamp: earliestAllowedTime, updated: true };
		}

		return { timestamp, updated: false };
	}

	/**
	 * 日時入力を更新
	 */
	function updateDateTimeInput(timestamp: number) {
		dateInput.value = formatTimestamp(timestamp, 'date');
		timeInput.value = formatTimestamp(timestamp, 'time');
	}

	/**
	 * 指定日時にジャンプ
	 */
	function goToDateTime(onComplete?: () => void): void {
		if (!isValidDateTime.value) return;

		const datetime = new Date(`${dateInput.value}T${timeInput.value}`);
		let targetTimestamp = datetime.getTime();

		// ロールポリシーによる時刻制限をチェック
		const { timestamp: checkedTimestamp, updated } = checkTimestampPolicy(targetTimestamp);
		targetTimestamp = checkedTimestamp;

		if (updated) {
			// 入力値を制限時刻に更新
			updateDateTimeInput(targetTimestamp);
			// 通知を表示
			os.toast(String(i18n.ts.timemachineReachedLimit));
		}

		paginator.value = createPaginator(targetTimestamp);
		timelineKey.value++;
		showControls.value = false;

		if (onComplete) {
			onComplete();
		}
	}

	/**
	 * コントロールパネルの表示/非表示を切り替え
	 */
	function toggleControls() {
		showControls.value = !showControls.value;
	}

	/**
	 * 新しいノートを読み込む
	 */
	async function loadNewer(): Promise<void> {
		const scrollContainer = options.scrollContainerRef?.value;
		if (!paginator.value || isLoadingNewer.value || !scrollContainer) return;

		isLoadingNewer.value = true;

		try {
			// 最初のノート要素を取得（追跡用）
			const firstNoteElement = scrollContainer.querySelector('[data-scroll-anchor]') as HTMLElement;
			const scrollContainerRect = scrollContainer.getBoundingClientRect();
			const firstNoteRect = firstNoteElement?.getBoundingClientRect();
			const firstNoteOffsetFromTop = firstNoteRect && scrollContainerRect ? firstNoteRect.y - scrollContainerRect.y : null;

			// 新しいノートを取得
			await paginator.value.fetchNewer();

			// DOM更新を待つ
			await nextTick();
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			// スクロール位置を復元
			if (firstNoteElement && firstNoteOffsetFromTop !== null && scrollContainerRect) {
				const currentScrollContainerRect = scrollContainer.getBoundingClientRect();
				const currentNoteRect = firstNoteElement.getBoundingClientRect();
				const currentOffsetFromTop = currentNoteRect.y - currentScrollContainerRect.y;
				const positionDiff = currentOffsetFromTop - firstNoteOffsetFromTop;

				scrollContainer.scrollTop += positionDiff;
			}

			// 日時入力を更新
			const items = paginator.value.items.value;
			if (items && items.length > 0) {
				const date = new Date(items[0].createdAt);
				updateDateTimeInput(date.getTime());
			}
		} catch (error) {
			console.error('Failed to load newer notes:', error);
			os.toast(i18n.ts.somethingHappened);
		} finally {
			isLoadingNewer.value = false;
		}
	}

	return {
		// State
		showControls,
		timelineSource,
		dateInput,
		timeInput,
		paginator,
		timelineKey,
		isLoadingNewer,

		// Computed
		targetDate,
		isValidDateTime,

		// Methods
		createPaginator,
		checkTimestampPolicy,
		updateDateTimeInput,
		goToDateTime,
		toggleControls,
		loadNewer,
	};
}
