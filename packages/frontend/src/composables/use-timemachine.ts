/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, computed, watch, type Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { TimeshiftPaginator, TimelineEndpoint } from '@/utility/timeshiftPaginator.js';
import { useStream } from '@/stream.js';

// ========================================
// Utility Functions (useTimelineEndpoint)
// ========================================

/**
 * タイムラインソースからエンドポイントを取得
 */
export function getEndpointForSource(source: 'home' | 'local' | 'social' | 'global'): TimelineEndpoint {
	switch (source) {
		case 'home': return 'notes/timeline';
		case 'local': return 'notes/local-timeline';
		case 'social': return 'notes/hybrid-timeline';
		case 'global': return 'notes/global-timeline';
	}
}

/**
 * タイムラインソースからチャンネル名を取得
 */
export function getChannelForSource(source: 'home' | 'local' | 'social' | 'global'): string {
	switch (source) {
		case 'home': return 'homeTimeline';
		case 'local': return 'localTimeline';
		case 'social': return 'hybridTimeline';
		case 'global': return 'globalTimeline';
	}
}

// ========================================
// useTimeshiftSeek - シーク操作の管理
// ========================================

/**
 * タイムシフトのシーク操作を管理するComposable
 *
 * @param paginator - TimeshiftPaginatorのRef
 * @param isPlaying - 再生中かどうかのRef
 * @param onPause - 一時停止時のコールバック
 * @param onPlay - 再生時のコールバック
 */
export function useTimeshiftSeek(
	paginator: Ref<TimeshiftPaginator | null>,
	isPlaying: Ref<boolean>,
	onPause: () => void,
	onPlay: () => void,
) {
	const isUserSeeking = ref(false);
	const wasPlayingBeforeSeek = ref(false);

	function onSeekInput(value: number) {
		paginator.value?.updatePlaybackTime(value);
	}

	function onSeekChange(value: number) {
		paginator.value?.updatePlaybackTime(value);
	}

	function pauseOnSeek() {
		isUserSeeking.value = true;
		wasPlayingBeforeSeek.value = isPlaying.value;
		if (isPlaying.value) {
			onPause();
		}
	}

	function resumeAfterSeek() {
		isUserSeeking.value = false;
		if (wasPlayingBeforeSeek.value) {
			onPlay();
		}
	}

	return {
		isUserSeeking,
		wasPlayingBeforeSeek,
		onSeekInput,
		onSeekChange,
		pauseOnSeek,
		resumeAfterSeek,
	};
}

// ========================================
// useTimeshiftPlayback - 再生制御の管理
// ========================================

/**
 * タイムシフト再生制御を管理するComposable
 *
 * @param paginator - TimeshiftPaginatorのRef
 * @param options - オプション設定
 * @param options.onError - エラー時のコールバック
 */
export function useTimeshiftPlayback(
	paginator: Ref<TimeshiftPaginator | null>,
	options?: {
		onError?: (error: Error) => void;
	},
) {
	const isTimeshiftPlaying = ref(false);
	const playbackSpeed = ref(1);
	const timeshiftIntervalId = ref<number | null>(null);

	/**
	 * 再生速度に応じたインターバル時間を取得
	 * 速度が速いほど高フレームレート（短い間隔）で視認性を向上
	 */
	const getInterval = (speed: number) => {
		if (speed <= 1) return 1000;  // x0.5, x1: 1000ms間隔（低頻度）
		if (speed <= 2) return 500;   // x2: 500ms間隔
		if (speed <= 5) return 200;   // x5: 200ms間隔
		return 100;                   // x10以上: 100ms間隔（高頻度、滑らか）
	};

	/**
	 * タイムシフト再生を開始
	 */
	function play() {
		if (timeshiftIntervalId.value !== null || !paginator.value) return;

		isTimeshiftPlaying.value = true;

		const updatePlayback = () => {
			const p = paginator.value;
			if (!p) return;
			const currentTime = p.playbackTime.value;
			if (currentTime === null) return;

			const interval = getInterval(playbackSpeed.value);
			const advancement = interval * playbackSpeed.value;

			p.updatePlaybackTime(currentTime + advancement);

			// プリフェッチチェック
			p.checkAndPrefetch().catch((error) => {
				if (options?.onError) {
					options.onError(error);
				}
				stop();
			});
		};

		// 初回実行
		updatePlayback();

		// インターバルで繰り返し実行
		const interval = getInterval(playbackSpeed.value);
		timeshiftIntervalId.value = window.setInterval(updatePlayback, interval);
	}

	/**
	 * タイムシフト再生を一時停止
	 */
	function pause() {
		if (timeshiftIntervalId.value !== null) {
			clearInterval(timeshiftIntervalId.value);
			timeshiftIntervalId.value = null;
		}
		isTimeshiftPlaying.value = false;
	}

	/**
	 * タイムシフト再生を停止
	 */
	function stop() {
		pause();
	}

	// playbackSpeed変更時の自動再起動
	watch(playbackSpeed, () => {
		const wasPlaying = isTimeshiftPlaying.value;
		if (wasPlaying) {
			pause();
			play();
		}
	});

	/**
	 * クリーンアップ処理
	 */
	function cleanup() {
		if (timeshiftIntervalId.value !== null) {
			clearInterval(timeshiftIntervalId.value);
			timeshiftIntervalId.value = null;
		}
	}

	return {
		isTimeshiftPlaying,
		playbackSpeed,
		play,
		pause,
		stop,
		cleanup,
	};
}

// ========================================
// useTimeshiftComputed - paginator依存のcomputed群
// ========================================

/**
 * TimeshiftPaginatorの状態から派生するcomputed値を提供するComposable
 *
 * @param paginator - TimeshiftPaginatorのRef
 */
export function useTimeshiftComputed(paginator: Ref<TimeshiftPaginator | null>) {
	const isTimeshiftMode = computed(() => {
		const p = paginator.value;
		if (!p) return false;
		return p.isTimeshiftMode.value;
	});

	const playbackTime = computed(() => {
		const p = paginator.value;
		if (!p) return null;
		return p.playbackTime.value;
	});

	const timeshiftStartTime = computed(() => {
		const p = paginator.value;
		if (!p) return null;
		return p.timeshiftStartTime.value;
	});

	const timeshiftEndTime = computed(() => {
		const p = paginator.value;
		return p?.getTimeshiftEndTime() ?? 0;
	});

	const isTimefusionMode = computed(() => {
		const p = paginator.value;
		if (!p) return false;
		return p.isTimefusionMode.value;
	});

	const canLoadNewer = computed(() => {
		const p = paginator.value;
		return (p?.items?.value?.length ?? 0) > 0;
	});

	return {
		isTimeshiftMode,
		playbackTime,
		timeshiftStartTime,
		timeshiftEndTime,
		isTimefusionMode,
		canLoadNewer,
	};
}

// ========================================
// useTimefusionStream - リアルタイムストリーム管理
// ========================================

/**
 * タイムフュージョンモードのリアルタイムストリームを管理するComposable
 *
 * @param paginator - TimeshiftPaginatorのRef
 * @param timelineSource - タイムラインソース
 */
export function useTimefusionStream(
	paginator: Ref<TimeshiftPaginator | null>,
	timelineSource: Ref<'home' | 'local' | 'social' | 'global'>,
) {
	let noteStream: ReturnType<Misskey.IStream['useChannel']> | null = null;

	/**
	 * リアルタイムストリームをセットアップ
	 */
	function setupStream() {
		if (noteStream) {
			noteStream.dispose();
		}

		const connection = useStream();
		const channelName = getChannelForSource(timelineSource.value);
		noteStream = connection.useChannel(channelName as any);

		if (noteStream.on) {
			noteStream.on('note', (note: Misskey.entities.Note) => {
				const p = paginator.value;
				if (p && p.isTimefusionMode.value) {
					p.addRealtimeItem(note);
				}
			});
		}
	}

	/**
	 * タイムフュージョンモードの切り替え
	 */
	function toggle() {
		if (!paginator.value) return;

		if (paginator.value.isTimefusionMode.value) {
			paginator.value.stopTimefusion();
			if (noteStream) {
				noteStream.dispose();
				noteStream = null;
			}
		} else {
			paginator.value.startTimefusion();
			setupStream();
		}
	}

	/**
	 * クリーンアップ処理
	 */
	function cleanup() {
		if (noteStream) {
			noteStream.dispose();
			noteStream = null;
		}
	}

	return {
		setupStream,
		toggle,
		cleanup,
	};
}
