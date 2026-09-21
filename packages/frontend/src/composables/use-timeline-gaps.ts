/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { ComputedRef, Ref } from 'vue';
import type { IPaginator, MisskeyEntity } from '@/utility/paginator.js';

/**
 * タイムライン上の「未取得区間 (歯抜け)」を表すマーカー。
 * paginator.items には混ぜず、表示用の displayItems で合成する。
 */
export type TimelineGap = {
	/** 表示 key 用。生成時に採番して固定する (境界 id は補給のたびに進むため key には使わない) */
	id: string;
	/** MisskeyEntity と同じ形にするためだけに持つ。日付セパレータ判定には参加させない */
	createdAt: string;
	_type: 'gap';
	/** 旧セグメント側の境界 (この id より新しいものが未取得)。このノートの直前にマーカーを描画する */
	sinceId: string;
	/** 新セグメント側の境界。null は「sinceId から現在まで」 */
	untilId: string | null;
	fetching: boolean;
	/** 生成直後の自動補給がまだ実行されていない */
	autoFillPending: boolean;
};

export type TimelineItem = (Misskey.entities.Note & MisskeyEntity) | TimelineGap;

export function isTimelineGap(item: TimelineItem): item is TimelineGap {
	return '_type' in item && item._type === 'gap';
}

const GAP_FETCH_LIMIT = 30;

export function useTimelineGaps(paginator: IPaginator<Misskey.entities.Note>, options: {
	/** 生成直後の自動補給を今すぐ実行してよいか (先頭表示中かつ非アクティブでない、など) */
	canAutoFill: () => boolean;
	/** マーカーの DOM 要素 (補給後に見えていれば続けるための判定用) */
	getGapElement: (gapId: string) => HTMLElement | null;
	getScrollContainer: () => HTMLElement | null;
}): {
	gaps: Ref<TimelineGap[]>;
	displayItems: ComputedRef<TimelineItem[]>;
	openGap: (init?: { sinceId?: string | null; untilId?: string | null }) => TimelineGap | null;
	onQueueOverflow: (oldestRemainingQueuedId: string) => void;
	bindUntil: (noteId: string) => void;
	fill: (gap: TimelineGap) => Promise<void>;
	tryAutoFill: () => void;
	onNoteRemoved: (noteId: string) => void;
	reset: () => void;
} {
	const gaps = ref<TimelineGap[]>([]);
	let counter = 0;

	const displayItems = computed<TimelineItem[]>(() => {
		const items = paginator.items.value;
		if (gaps.value.length === 0) return items;

		const out: TimelineItem[] = [];
		const placed = new Set<string>();
		for (const note of items) {
			for (const gap of gaps.value) {
				if (gap.sinceId === note.id) {
					out.push(gap);
					placed.add(gap.id);
				}
			}
			out.push(note);
		}

		// sinceId のノートが items に無い (先読みキューにいる等) が「現在まで」を表すマーカーは先頭に出す
		const heads = gaps.value.filter(gap => !placed.has(gap.id) && gap.untilId == null);
		if (heads.length > 0) out.unshift(...heads);

		return out;
	});

	function hasItem(id: string): boolean {
		return paginator.items.value.some(x => x.id === id);
	}

	function getNewestItemId(): string | null {
		// 様々な要因により並び順は保証されないのでソートが必要
		return paginator.items.value.map(x => x.id).sort().at(-1) ?? null;
	}

	function findGap(gapId: string): TimelineGap | null {
		return gaps.value.find(g => g.id === gapId) ?? null;
	}

	function remove(gap: TimelineGap): void {
		const index = gaps.value.findIndex(g => g.id === gap.id);
		if (index !== -1) gaps.value.splice(index, 1);
	}

	function reset(): void {
		if (gaps.value.length === 0) return;
		gaps.value = [];
	}

	function openGap(init: { sinceId?: string | null; untilId?: string | null } = {}): TimelineGap | null {
		const sinceId = init.sinceId ?? paginator.getNewestId() ?? null;
		if (sinceId == null) return null;
		const untilId = init.untilId ?? null;

		// 同じ sinceId のマーカーがあれば統合する (区間が広い方を採用)
		const existing = gaps.value.find(g => g.sinceId === sinceId);
		if (existing != null) {
			if (untilId == null) {
				existing.untilId = null;
			} else if (existing.untilId != null && untilId > existing.untilId) {
				existing.untilId = untilId;
			}
			existing.autoFillPending = true;
			tryAutoFill();
			return existing;
		}

		const anchor = paginator.items.value.find(x => x.id === sinceId);
		gaps.value.push({
			id: `gap:${counter++}`,
			createdAt: anchor?.createdAt ?? new Date().toISOString(),
			_type: 'gap',
			sinceId,
			untilId,
			fetching: false,
			autoFillPending: true,
		});
		tryAutoFill();
		return gaps.value[gaps.value.length - 1]!;
	}

	function onQueueOverflow(oldestRemainingQueuedId: string): void {
		// 捨てられたのは items の最新とキューに残った最古の間
		const sinceId = getNewestItemId();
		if (sinceId == null || oldestRemainingQueuedId <= sinceId) return;
		openGap({ sinceId, untilId: oldestRemainingQueuedId });
	}

	function bindUntil(noteId: string): void {
		for (const gap of gaps.value) {
			if (gap.untilId == null && noteId > gap.sinceId) {
				gap.untilId = noteId;
			}
		}
	}

	function isGapVisible(gap: TimelineGap): boolean {
		const el = options.getGapElement(gap.id);
		if (el == null) return false;
		const rect = el.getBoundingClientRect();
		const container = options.getScrollContainer();
		const bounds = container != null
			? container.getBoundingClientRect()
			: { top: 0, bottom: window.innerHeight };
		return rect.bottom > bounds.top && rect.top < bounds.bottom;
	}

	async function fill(gap: TimelineGap): Promise<void> {
		if (gap.fetching) return;
		gap.autoFillPending = false;

		if (!hasItem(gap.sinceId)) {
			// sinceId のノートが先読みキューにいる可能性がある。「現在まで」のマーカーは先頭に出ているので解放して取り込む
			if (gap.untilId == null) paginator.releaseQueue();
			if (!hasItem(gap.sinceId)) {
				// それでも無ければ trim で旧セグメントごと消えている。以後は fetchOlder が連続するので穴は残らない
				remove(gap);
				return;
			}
		}

		gap.fetching = true;
		const res = await paginator.fetchRange({
			sinceId: gap.sinceId,
			untilId: gap.untilId,
			limit: GAP_FETCH_LIMIT,
		});
		gap.fetching = false;

		if (res == null) return; // 失敗時はマーカーを残して再試行できるようにする
		if (findGap(gap.id) == null) return; // reload 等で消えた
		if (res.length === 0) {
			remove(gap);
			return;
		}

		// untilId 指定時は降順、sinceId のみのときは昇順で返るので表示順 (新しい順) に揃える
		const descending = gap.untilId != null ? res : res.toReversed();
		const inserted = paginator.insertItemsBefore(gap.sinceId, descending);

		if (inserted === 0 && !hasItem(gap.sinceId)) {
			// fetch 中にアンカーが trim / 削除された
			remove(gap);
			return;
		}

		if (gap.untilId != null) {
			// 新しい側から埋めたので、残りは取得した最古より下
			gap.untilId = descending[descending.length - 1]!.id;
		} else {
			// 古い側から埋めたので、残りは取得した最新より上
			gap.sinceId = descending[0]!.id;
		}

		if (res.length < GAP_FETCH_LIMIT || inserted === 0) {
			remove(gap);
			return;
		}

		// 残りがあり、マーカーがまだ画面内に見えているなら続ける
		// (v-appear は交差の変化でしか発火しないため、自前で判定する)
		await nextTick();
		if (findGap(gap.id) != null && isGapVisible(gap)) {
			void fill(gap);
		}
	}

	function tryAutoFill(): void {
		if (!options.canAutoFill()) return;
		for (const gap of gaps.value) {
			if (gap.autoFillPending && !gap.fetching) {
				void fill(gap);
			}
		}
	}

	function onNoteRemoved(noteId: string): void {
		const items = paginator.items.value;
		for (const gap of [...gaps.value]) {
			if (gap.sinceId !== noteId) continue;
			// 削除済ノートは戻ってこないので、1 つ下 (古い側) のノートに付け替える
			const index = items.findIndex(x => x.id === noteId);
			const next = index !== -1 ? items[index + 1] : undefined;
			if (next != null) {
				gap.sinceId = next.id;
			} else {
				remove(gap);
			}
		}
	}

	// init() / reload() で items が丸ごと差し替わるときはマーカーも捨てる
	// (取り直した最新分は連続しているので、古いマーカーが残ると無意味な補給が走る)
	watch(paginator.fetching, (fetching) => {
		if (fetching) reset();
	});

	return {
		gaps,
		displayItems,
		openGap,
		onQueueOverflow,
		bindUntil,
		fill,
		tryAutoFill,
		onNoteRemoved,
		reset,
	};
}
