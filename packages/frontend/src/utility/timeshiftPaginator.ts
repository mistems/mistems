/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import { Paginator } from './paginator.js';
import type { Ref, ComputedRef } from 'vue';

// タイムマシン機能でサポートするエンドポイント
export type TimelineEndpoint =
	| 'notes/timeline'
	| 'notes/local-timeline'
	| 'notes/hybrid-timeline'
	| 'notes/global-timeline';

// タイムフュージョン用のノート型
export interface FusionNote extends Misskey.entities.Note {
	_isRealtime?: boolean; // リアルタイム由来かどうかのフラグ
	_realtimeInsertTime?: number; // 受信時の playbackTime（リアルタイムノートのみ）
}

/**
 * ノートがFusionNote型かどうかを判定する型ガード関数
 */
export function isFusionNote(note: Misskey.entities.Note | FusionNote): note is FusionNote {
	return '_isRealtime' in note || '_realtimeInsertTime' in note;
}

/**
 * タイムマシン機能専用のPaginator
 * Misskey.entities.Note型に特化したシンプルな実装
 */
export class TimeshiftPaginator extends Paginator<TimelineEndpoint> {
	// タイムシフト状態
	public isTimeshiftMode: Ref<boolean>;
	public playbackTime: Ref<number | null>;
	public timeshiftStartTime: Ref<number | null>;

	// 内部バッファ（全フェッチ済みノート）
	private allFetchedItems: Ref<Misskey.entities.Note[]>;

	// タイムシフト用のキューとアイテム
	private queuedItems: Ref<Misskey.entities.Note[]>; // 未来のノートのキュー
	public timeshiftItems: Ref<Misskey.entities.Note[]>; // 表示用アイテム（refに変更）

	// タイムフュージョン用の新規プロパティ
	public isTimefusionMode: Ref<boolean>;
	private realtimeItems: Ref<FusionNote[]>; // 内部管理用、直接画面表示しない
	public fusionItems: Ref<FusionNote[]>; // 画面表示用、追加専用
	private fusionItemIds: Set<string>; // 重複チェック用

	constructor(
		endpoint: TimelineEndpoint,
		props: {
			computedParams?: ComputedRef<Record<string, any>>;
			initialDate?: number | null;
			initialDirection?: 'newer' | 'older';
			useShallowRef?: false;
		} = {},
	) {
		super(endpoint, props as any);

		// タイムシフト状態の初期化
		this.isTimeshiftMode = ref(false);
		this.playbackTime = ref(null);
		this.timeshiftStartTime = ref(null);
		this.allFetchedItems = ref<Misskey.entities.Note[]>([]);
		this.queuedItems = ref<Misskey.entities.Note[]>([]);
		this.timeshiftItems = ref<Misskey.entities.Note[]>([]);

		// タイムフュージョン状態の初期化
		this.isTimefusionMode = ref(false);
		this.realtimeItems = ref<FusionNote[]>([]);
		this.fusionItems = ref<FusionNote[]>([]);
		this.fusionItemIds = new Set<string>();

		// Bind methods
		this.startTimeshift = this.startTimeshift.bind(this);
		this.stopTimeshift = this.stopTimeshift.bind(this);
		this.updatePlaybackTime = this.updatePlaybackTime.bind(this);
		this.checkAndPrefetch = this.checkAndPrefetch.bind(this);
		this.getTimeshiftEndTime = this.getTimeshiftEndTime.bind(this);
		this.startTimefusion = this.startTimefusion.bind(this);
		this.stopTimefusion = this.stopTimefusion.bind(this);
		this.addRealtimeItem = this.addRealtimeItem.bind(this);
	}

	// タイムシフト開始
	startTimeshift(startTime: number): void {
		this.isTimeshiftMode.value = true;
		this.timeshiftStartTime.value = startTime;
		this.playbackTime.value = startTime;

		// 現在の items を取得
		const initialItems = this.items.value || [];

		// 重複除去
		const seenIds = new Set<string>();
		const deduplicated = initialItems.filter((item) => {
			if (seenIds.has(item.id)) {
				return false;
			}
			seenIds.add(item.id);
			return true;
		});

		// allFetchedItems に保存（fetchNewer用）
		this.allFetchedItems.value = deduplicated;

		// 時刻でソート（新しい順）
		const sortedItems = [...deduplicated].sort((a, b) => {
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});

		// playbackTime より過去のノートと未来のノートに分ける
		const pastItems: Misskey.entities.Note[] = [];
		const futureItems: Misskey.entities.Note[] = [];

		for (const item of sortedItems) {
			const itemTime = new Date(item.createdAt).getTime();
			if (itemTime <= startTime) {
				pastItems.push(item);
			} else {
				futureItems.push(item);
			}
		}

		// 過去10件を timeshiftItems に設定
		const initialPastItems = pastItems.slice(0, 10);
		this.timeshiftItems.value.splice(0, this.timeshiftItems.value.length, ...initialPastItems);

		// 未来のノートを queuedItems に設定（古い順にソート）
		const reversedFutureItems = futureItems.reverse();
		this.queuedItems.value.splice(0, this.queuedItems.value.length, ...reversedFutureItems);
	}

	// タイムシフト停止
	stopTimeshift(): void {
		// 停止時に現在のtimeshiftItemsをitemsに移動（通常モードでの表示とfetchNewer用）
		// これにより、停止後も直前まで見ていたアイテムが表示され、fetchNewerで続きを取得できる
		if (this.timeshiftItems.value.length > 0) {
			this.items.value.splice(0, this.items.value.length, ...this.timeshiftItems.value);
			// アイテムがある場合はfetchNewerを有効化
			this.canFetchNewer.value = true;
		}

		// 現在のplaybackTimeをinitialDateとして保存（次回のジャンプ用）
		if (this.playbackTime.value !== null) {
			this.initialDate = this.playbackTime.value;
		}

		// タイムシフトモードを無効化
		this.isTimeshiftMode.value = false;
		this.playbackTime.value = null;
		this.timeshiftStartTime.value = null;

		// 内部バッファをクリア
		this.allFetchedItems.value.splice(0);
		this.queuedItems.value.splice(0);
		this.timeshiftItems.value.splice(0);
	}

	// 再生時刻の更新
	updatePlaybackTime(time: number): void {
		this.playbackTime.value = time;

		// キューから時刻が到達したノートを取り出して timeshiftItems に追加
		const itemsToAdd: Misskey.entities.Note[] = [];
		while (this.queuedItems.value.length > 0) {
			const nextItem = this.queuedItems.value[0];
			const itemTime = new Date(nextItem.createdAt).getTime();

			if (itemTime <= time) {
				// 時刻が到達したので、追加リストに入れる
				this.queuedItems.value.shift(); // キューから削除
				itemsToAdd.push(nextItem);
			} else {
				// まだ時刻に到達していないので終了
				break;
			}
		}

		// 先頭に追加
		if (itemsToAdd.length > 0) {
			this.timeshiftItems.value.unshift(...itemsToAdd);

			// タイムフュージョンモードの場合はfusionItemsにも追加
			if (this.isTimefusionMode.value) {
				const fusionNotesToAdd = itemsToAdd
					.filter(item => !this.fusionItemIds.has(item.id))
					.map(item => item as FusionNote);

				if (fusionNotesToAdd.length > 0) {
					this.fusionItems.value.unshift(...fusionNotesToAdd);
					fusionNotesToAdd.forEach(item => this.fusionItemIds.add(item.id));
				}
			}
		}
	}

	// 最後のfetchNewerで追加された新しいアイテムの数を記録（checkAndPrefetchで使用）
	private lastFetchedNewItemsCount = 0;

	// fetchNewer のオーバーライド
	async fetchNewer(options: { toQueue?: boolean } = {}): Promise<void> {
		const MAX_ITEMS = 1000;
		const TRIM_TO = 500;

		// タイムシフトモード時は、fetchNewer前のアイテムIDを記録
		let beforeItemIds: Set<string> | null = null;
		if (this.isTimeshiftMode.value && !options.toQueue) {
			beforeItemIds = new Set((this.items.value || []).map((item) => item.id));
		}

		await super.fetchNewer(options);

		// タイムシフトモード時は、トリミング前に新しいアイテムを抽出して allFetchedItems とキューに追加
		if (this.isTimeshiftMode.value && !options.toQueue && beforeItemIds) {
			// super.fetchNewer() で実際に追加されたアイテムのみを抽出（差分）
			const newItems = (this.items.value || []).filter((item) => !beforeItemIds.has(item.id));

			// 新しいアイテムの数を記録
			this.lastFetchedNewItemsCount = newItems.length;

			// allFetchedItems に追加
			this.allFetchedItems.value.push(...newItems);

			// 新しいアイテムをキューに追加（時刻順にソート）
			// playbackTime より未来のノートのみキューに追加
			const futureItems = newItems.filter((item) => {
				const itemTime = new Date(item.createdAt).getTime();
				return itemTime > (this.playbackTime.value || 0);
			});

			// キューに追加してソート（古い順）
			this.queuedItems.value.push(...futureItems);
			this.queuedItems.value.sort((a, b) => {
				return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			});
		} else {
			// タイムシフトモード以外では0を設定
			this.lastFetchedNewItemsCount = 0;
		}

		// トリミング処理（newItems 抽出後に実行）
		if (this.items.value && this.items.value.length > MAX_ITEMS) {
			this.items.value.splice(TRIM_TO);
		}

		// タイムシフトモード時の各配列のトリミング処理
		if (this.isTimeshiftMode.value && !options.toQueue) {
			// allFetchedItems が 1000 を超えた場合も末尾を削除
			if (this.allFetchedItems.value.length > MAX_ITEMS) {
				this.allFetchedItems.value.splice(TRIM_TO);
			}

			// timeshiftItems が 1000 を超えた場合も末尾を削除
			if (this.timeshiftItems.value.length > MAX_ITEMS) {
				this.timeshiftItems.value.splice(TRIM_TO);
			}

			// fusionItems が 1000 を超えた場合も末尾を削除
			if (this.fusionItems.value.length > MAX_ITEMS) {
				this.fusionItems.value.splice(TRIM_TO);
			}
		}
	}

	// fetchOlder のオーバーライド（タイムシフト中の過去方向読み込みで自動停止）
	async fetchOlder(): Promise<void> {
		// タイムシフトモード中に過去方向の読み込みが実行された場合、タイムシフトを停止
		if (this.isTimeshiftMode.value) {
			this.stopTimeshift();
		}

		// タイムフュージョンモードも停止
		if (this.isTimefusionMode.value) {
			this.stopTimefusion();
		}

		// 通常の fetchOlder を実行
		await super.fetchOlder();
	}

	// プリフェッチチェック
	async checkAndPrefetch(): Promise<void> {
		if (!this.playbackTime.value || !this.isTimeshiftMode.value) return;

		// キューの残りが10件以下になったらプリフェッチ
		const queueThreshold = 10;
		if (this.queuedItems.value.length <= queueThreshold) {
			await this.fetchNewer();

			// 新しいアイテムがない場合は例外をスロー（呼び出し側で stopTimeshift() を実行）
			// トリミング処理を考慮し、実際に追加された新しいアイテムの数で判定
			if (this.lastFetchedNewItemsCount === 0) {
				throw new Error('No more items to prefetch');
			}
		}
	}

	// タイムシフト終了時刻を取得
	getTimeshiftEndTime(): number {
		if (this.allFetchedItems.value.length === 0) {
			return (this.timeshiftStartTime.value || 0) + 3600 * 1000; // デフォルト: +1時間
		}
		return Math.max(...this.allFetchedItems.value.map((item) => new Date(item.createdAt).getTime()));
	}

	// タイムフュージョンモードを開始
	startTimefusion(): void {
		this.isTimefusionMode.value = true;
		this.fusionItemIds.clear();

		// 初期状態：現在のtimeshiftItemsをfusionItemsに設定
		this.fusionItems.value.splice(0);
		for (const item of this.timeshiftItems.value) {
			this.fusionItems.value.push(item as FusionNote);
			this.fusionItemIds.add(item.id);
		}
	}

	// タイムフュージョンモードを停止
	stopTimefusion(): void {
		this.isTimefusionMode.value = false;
		this.realtimeItems.value.splice(0);
		this.fusionItems.value.splice(0);
		this.fusionItemIds.clear();
	}

	// リアルタイムノートを追加（WebSocketから呼び出される）
	addRealtimeItem(note: Misskey.entities.Note): void {
		if (!this.isTimefusionMode.value) {
			return;
		}

		if (this.fusionItemIds.has(note.id)) {
			return;
		}

		// リアルタイムフラグと受信時の playbackTime を付与
		const noteWithFlag: FusionNote = {
			...note,
			_isRealtime: true,
			_realtimeInsertTime: this.playbackTime.value || Date.now(), // 受信時の位置を記録
		};

		// realtimeItems に追加（内部管理用）
		this.realtimeItems.value.unshift(noteWithFlag);

		// 上限管理（メモリ対策）
		const MAX_REALTIME_ITEMS = 100;
		if (this.realtimeItems.value.length > MAX_REALTIME_ITEMS) {
			this.realtimeItems.value.splice(MAX_REALTIME_ITEMS);
		}

		// fusionItems の先頭に追加
		this.fusionItems.value.unshift(noteWithFlag);
		this.fusionItemIds.add(note.id);
	}
}
