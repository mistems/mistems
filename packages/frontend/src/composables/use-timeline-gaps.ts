/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, reactive, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { ComputedRef, Ref } from 'vue';
import { SECOND_FETCH_LIMIT } from '@/utility/paginator.js';
import type { IPaginator, MisskeyEntity } from '@/utility/paginator.js';

/**
 * タイムライン上の「未取得区間 (歯抜け)」を表すマーカー。
 * paginator.items には混ぜず、表示用の displayItems で合成する。
 *
 * Misskey API のページネーション規約: sinceId は「この id より新しいもの」、untilId は「この id より古いもの」を指す (どちらも排他)。
 * id は辞書順 = 時系列順 (Paginator も同じ前提で id をソートしている)。
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
	/** 自動補給の連続回数 (上限に達したら手動クリック待ちにする)。手動クリックでリセット */
	autoContinueCount: number;
};

export type TimelineItem = (Misskey.entities.Note & MisskeyEntity) | TimelineGap;

export function isTimelineGap(item: TimelineItem): item is TimelineGap {
	return (item as { _type?: unknown })._type === 'gap';
}

/** 1 回の補給で取得する件数。通常の fetchOlder / fetchNewer と同じ */
const GAP_FETCH_LIMIT = SECOND_FETCH_LIMIT;

/**
 * 自動補給 (ユーザー操作なし) の連続回数の上限。
 * 大規模な切断の復旧直後に全クライアントが延々と取得し続けるのを防ぐ。上限に達したらマーカーを残して手動クリック待ちにする
 */
const MAX_AUTO_CONTINUE = 3;

export function useTimelineGaps(paginator: IPaginator<Misskey.entities.Note>, options: {
	/** 自動補給 (生成直後 / 自動継続) を今すぐ実行してよいか (先頭表示中かつ非アクティブでない、など) */
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

	/**
	 * 表示中 (items) の最新 id。
	 * paginator.getNewestId() は先読みキューを優先するが、キュー溢れの境界は「items 側の最新」なのでこちらを使う
	 */
	function getNewestDisplayedItemId(): string | null {
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

	/**
	 * 同じ sinceId のマーカーは 1 つに統合する (区間が広い方を採用)。
	 * untilId が null (現在まで) は確定済の untilId より広いとみなす
	 */
	function mergeInto(existing: TimelineGap, untilId: string | null): void {
		if (untilId == null) {
			existing.untilId = null;
		} else if (existing.untilId != null && untilId > existing.untilId) {
			existing.untilId = untilId;
		}
	}

	function openGap(init: { sinceId?: string | null; untilId?: string | null } = {}): TimelineGap | null {
		const sinceId = init.sinceId ?? paginator.getNewestId() ?? null;
		if (sinceId == null) return null;
		const untilId = init.untilId ?? null;

		const existing = gaps.value.find(g => g.sinceId === sinceId);
		if (existing != null) {
			mergeInto(existing, untilId);
			existing.autoFillPending = true;
			tryAutoFill();
			return existing;
		}

		const anchor = paginator.items.value.find(x => x.id === sinceId);
		// reactive() の proxy は同じ対象に対して共有されるので、配列経由で取り出したものと同一になる
		const gap = reactive<TimelineGap>({
			id: `gap:${counter++}`,
			createdAt: anchor?.createdAt ?? new Date().toISOString(),
			_type: 'gap',
			sinceId,
			untilId,
			fetching: false,
			autoFillPending: true,
			autoContinueCount: 0,
		});
		gaps.value.push(gap);
		tryAutoFill();
		return gap;
	}

	function onQueueOverflow(oldestRemainingQueuedId: string): void {
		// 捨てられたのは items の最新とキューに残った最古の間
		const sinceId = getNewestDisplayedItemId();
		if (sinceId == null || oldestRemainingQueuedId <= sinceId) return;
		openGap({ sinceId, untilId: oldestRemainingQueuedId });
	}

	/**
	 * 「現在まで」(untilId == null) のマーカーの上限を、切断後に最初に届いたノートの id で確定させる。
	 * 現状の呼び出し経路では「現在まで」のマーカーは高々 1 つ (openGap が sinceId で統合するため)
	 */
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

	/**
	 * 区間を 1 ページ分補給する。手動クリック用 (自動継続の回数をリセットする)
	 */
	async function fill(gap: TimelineGap): Promise<void> {
		gap.autoContinueCount = 0;
		await fillPage(gap);
	}

	async function fillPage(gap: TimelineGap): Promise<void> {
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

		// backend の並び順は endpoint によって異なる (多くは untilId 指定時に降順・sinceId のみで昇順だが、
		// notes/mentions は常に昇順、roles/notes は常に降順) ので、信用せず id で新しい順に揃える
		const descending = res.toSorted((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
		// 取得分は必ず両境界の間にあるので、上限確定済でも「現在まで」でも sinceId ノートの直前に入れればよい
		// NOTE: 通常の fetch と違い _shouldInsertAd_ は立てない (補給ノートに広告を混ぜない)
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

		// 残りがあり、マーカーがまだ画面内に見えていて、自動補給してよい状況なら続ける
		// (v-appear は交差の変化でしか発火しないため、自前で判定する)
		await nextTick();
		if (findGap(gap.id) == null) return;
		if (!isGapVisible(gap) || !options.canAutoFill()) return;
		if (gap.autoContinueCount >= MAX_AUTO_CONTINUE) return; // 上限に達したら手動クリック待ち
		gap.autoContinueCount++;
		void fillPage(gap);
	}

	function tryAutoFill(): void {
		if (!options.canAutoFill()) return;
		for (const gap of gaps.value) {
			if (gap.autoFillPending && !gap.fetching) {
				void fillPage(gap);
			}
		}
	}

	/**
	 * sinceId のノートが削除されたとき、1 つ下 (古い側) のノートに付け替える。
	 * 削除済ノートは戻ってこないので区間が広がっても実害はない。
	 * paginator.removeItem() より前に呼ぶこと (削除後だと items から隣を引けず、付け替えできない)
	 */
	function onNoteRemoved(noteId: string): void {
		const items = paginator.items.value;
		for (const gap of [...gaps.value]) {
			if (gap.sinceId !== noteId) continue;
			const index = items.findIndex(x => x.id === noteId);
			const next = index !== -1 ? items[index + 1] : undefined;
			if (next == null) {
				remove(gap);
				continue;
			}
			// 付け替え先に既にマーカーがあれば統合する (同じ sinceId のマーカーは 1 つ、の不変条件を保つ)
			const existing = gaps.value.find(g => g.id !== gap.id && g.sinceId === next.id);
			if (existing != null) {
				mergeInto(existing, gap.untilId);
				remove(gap);
			} else {
				gap.sinceId = next.id;
			}
		}
	}

	/**
	 * sinceId のノートが trim で items から押し出されたマーカーを捨てる。
	 * 表示されず fill も呼ばれなくなるため、放置すると gaps に残り続ける。
	 * sinceId が items の最新より新しいものは先読みキューにいる (解放で戻る) ので残す
	 */
	function pruneOrphans(): void {
		if (gaps.value.length === 0) return;
		const newest = getNewestDisplayedItemId();
		for (const gap of [...gaps.value]) {
			if (gap.untilId == null) continue; // 「現在まで」は先頭に表示され fill 側で処理される
			if (hasItem(gap.sinceId)) continue;
			if (newest != null && gap.sinceId > newest) continue; // キューにいる
			remove(gap);
		}
	}

	// items の変更 (trim / removeItem / unshift 等はすべて triggerRef か代入を伴う) のたびに孤立したマーカーを掃除する
	watch(paginator.items, pruneOrphans);

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
