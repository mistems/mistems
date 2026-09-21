/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { describe, test, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { Paginator } from '@/utility/paginator.js';
import { useTimelineGaps, isTimelineGap } from '@/composables/use-timeline-gaps.js';
import type { TimelineGap } from '@/composables/use-timeline-gaps.js';

type Note = Misskey.entities.Note;

// id は辞書順 = 時系列順になるようにする (Misskey の id と同じ性質)
function note(id: string): Note {
	return { id, createdAt: '2026-01-01T00:00:00.000Z' } as Note;
}

function ids(items: readonly { id: string }[]): string[] {
	return items.map(x => x.id);
}

function setup(initialItems: Note[], options: { canAutoFill?: boolean } = {}) {
	const paginator = new Paginator('notes/timeline', { useShallowRef: true });
	paginator.fetching.value = false;
	paginator.items.value = initialItems;

	const fetchRange = vi.spyOn(paginator, 'fetchRange');
	const gaps = useTimelineGaps(paginator, {
		canAutoFill: () => options.canAutoFill ?? false,
		getGapElement: () => null,
		getScrollContainer: () => null,
	});
	paginator.onQueueOverflow = gaps.onQueueOverflow;

	return { paginator, gaps, fetchRange };
}

// 新しい順 (降順) のノート列を作る: from から count 件、from より新しい側へ
function descendingNotes(newestId: string, count: number): Note[] {
	const base = parseInt(newestId.slice(1), 10);
	return Array.from({ length: count }, (_, i) => note('n' + String(base - i).padStart(3, '0')));
}

describe('useTimelineGaps', () => {
	describe('displayItems', () => {
		test('マーカーが無いときは items をそのまま返す', () => {
			const items = [note('n003'), note('n002'), note('n001')];
			const { gaps } = setup(items);
			expect(gaps.displayItems.value).toBe(items);
		});

		test('マーカーは sinceId のノートの直前に差し込まれる', () => {
			const { gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			expect(ids(gaps.displayItems.value)).toEqual(['n003', 'gap:0', 'n002', 'n001']);
		});

		test('sinceId のノートが items に無くても「現在まで」のマーカーは先頭に出る', () => {
			const { gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n010', untilId: null });
			expect(ids(gaps.displayItems.value)).toEqual(['gap:0', 'n003', 'n002', 'n001']);
		});

		test('sinceId のノートが items に無く上限も確定しているマーカーは描画しない', () => {
			const { gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n010', untilId: 'n020' });
			expect(ids(gaps.displayItems.value)).toEqual(['n003', 'n002', 'n001']);
		});

		test('items の in-place 変更 + triggerRef に追従する', () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			paginator.unshiftItems([note('n004')]);
			expect(ids(gaps.displayItems.value)).toEqual(['n004', 'n003', 'gap:0', 'n002', 'n001']);
			paginator.removeItem('n003');
			expect(ids(gaps.displayItems.value)).toEqual(['n004', 'gap:0', 'n002', 'n001']);
		});
	});

	describe('openGap', () => {
		test('sinceId 未指定なら paginator の最新 id (キュー優先) を使う', () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			paginator.enqueue(note('n005'));
			const gap = gaps.openGap();
			expect(gap?.sinceId).toBe('n005');
			expect(gap?.untilId).toBeNull();
		});

		test('同じ sinceId のマーカーは統合され、区間が広い方を採用する', () => {
			const { gaps } = setup([note('n003'), note('n002'), note('n001')]);
			const a = gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			const b = gaps.openGap({ sinceId: 'n002', untilId: 'n009' });
			expect(b).toBe(a);
			expect(gaps.gaps.value).toHaveLength(1);
			expect(gaps.gaps.value[0]!.untilId).toBe('n009');

			gaps.openGap({ sinceId: 'n002', untilId: null });
			expect(gaps.gaps.value[0]!.untilId).toBeNull();
		});

		test('items が空でキューも無ければ何もしない', () => {
			const { gaps } = setup([]);
			expect(gaps.openGap()).toBeNull();
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('canAutoFill が true なら生成直後に 1 回だけ補給する', async () => {
			const { gaps, fetchRange } = setup([note('n003'), note('n002'), note('n001')], { canAutoFill: true });
			fetchRange.mockResolvedValue([]);
			gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			expect(fetchRange).toHaveBeenCalledTimes(1);
			expect(fetchRange).toHaveBeenCalledWith({ sinceId: 'n002', untilId: 'n003', limit: 30 });
			await nextTick();
			// 空が返ったので即消える
			expect(gaps.gaps.value).toHaveLength(0);
		});
	});

	describe('bindUntil', () => {
		test('「現在まで」のマーカーだけ、sinceId より新しい id で上限を確定する', () => {
			const { gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n003', untilId: null });
			gaps.openGap({ sinceId: 'n001', untilId: 'n002' });

			gaps.bindUntil('n000'); // sinceId より古い → 無視
			expect(gaps.gaps.value[0]!.untilId).toBeNull();

			gaps.bindUntil('n010');
			expect(gaps.gaps.value[0]!.untilId).toBe('n010');
			expect(gaps.gaps.value[1]!.untilId).toBe('n002'); // 確定済のものは触らない
		});
	});

	describe('onQueueOverflow', () => {
		test('先読みキューが溢れたら items の最新とキューに残った最古の間にマーカーを立てる', () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			// MAX_QUEUE_ITEMS (100) を 1 件超えると最古 (n100) が捨てられる
			for (let i = 100; i <= 200; i++) {
				paginator.enqueue(note('n' + String(i).padStart(3, '0')));
			}
			expect(gaps.gaps.value).toHaveLength(1);
			expect(gaps.gaps.value[0]).toMatchObject({ sinceId: 'n003', untilId: 'n101' });
		});
	});

	describe('fill', () => {
		test('上限確定済: 新しい側から埋め、limit ちょうどなら untilId を進めてマーカーを残す', async () => {
			const { paginator, gaps, fetchRange } = setup([note('n100'), note('n002'), note('n001')]);
			const gap = gaps.openGap({ sinceId: 'n002', untilId: 'n100' })!;

			// n099..n070 (降順 30 件)
			fetchRange.mockResolvedValueOnce(descendingNotes('n099', 30));
			await gaps.fill(gap);

			expect(fetchRange).toHaveBeenLastCalledWith({ sinceId: 'n002', untilId: 'n100', limit: 30 });
			expect(paginator.items.value).toHaveLength(33);
			expect(ids(paginator.items.value).slice(0, 2)).toEqual(['n100', 'n099']);
			expect(ids(paginator.items.value).slice(-3)).toEqual(['n070', 'n002', 'n001']);
			expect(gaps.gaps.value).toHaveLength(1);
			expect(gap.untilId).toBe('n070');
			expect(gap.fetching).toBe(false);
			// マーカーは取得済の下、sinceId ノートの直前に残る
			const display = ids(gaps.displayItems.value);
			expect(display.indexOf('gap:0')).toBe(display.indexOf('n002') - 1);

			// limit 未満が返れば埋め切ったのでマーカーを消す
			fetchRange.mockResolvedValueOnce(descendingNotes('n069', 5));
			await gaps.fill(gap);
			expect(fetchRange).toHaveBeenLastCalledWith({ sinceId: 'n002', untilId: 'n070', limit: 30 });
			expect(paginator.items.value).toHaveLength(38);
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('「現在まで」: 古い側から埋め (昇順で返る)、sinceId を進める', async () => {
			const { paginator, gaps, fetchRange } = setup([note('n002'), note('n001')]);
			const gap = gaps.openGap({ sinceId: 'n002', untilId: null })!;

			// 昇順 30 件 n003..n032
			fetchRange.mockResolvedValueOnce(descendingNotes('n032', 30).toReversed());
			await gaps.fill(gap);

			expect(fetchRange).toHaveBeenLastCalledWith({ sinceId: 'n002', untilId: null, limit: 30 });
			expect(ids(paginator.items.value).slice(0, 2)).toEqual(['n032', 'n031']);
			expect(ids(paginator.items.value).slice(-2)).toEqual(['n002', 'n001']);
			expect(gap.sinceId).toBe('n032');
			expect(ids(gaps.displayItems.value).slice(0, 2)).toEqual(['gap:0', 'n032']);

			fetchRange.mockResolvedValueOnce([note('n033'), note('n034')]);
			await gaps.fill(gap);
			expect(fetchRange).toHaveBeenLastCalledWith({ sinceId: 'n032', untilId: null, limit: 30 });
			expect(ids(paginator.items.value).slice(0, 3)).toEqual(['n034', 'n033', 'n032']);
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('全件既知 (挿入 0 件) なら limit ちょうどでもマーカーを消す', async () => {
			const items = descendingNotes('n040', 40);
			const { paginator, gaps, fetchRange } = setup(items);
			const gap = gaps.openGap({ sinceId: 'n005', untilId: 'n040' })!;

			fetchRange.mockResolvedValueOnce(descendingNotes('n039', 30));
			await gaps.fill(gap);
			expect(paginator.items.value).toHaveLength(40);
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('取得失敗時はマーカーを残す (再試行できる)', async () => {
			const { gaps, fetchRange } = setup([note('n003'), note('n002'), note('n001')]);
			const gap = gaps.openGap({ sinceId: 'n002', untilId: 'n003' })!;
			fetchRange.mockResolvedValueOnce(null);
			await gaps.fill(gap);
			expect(gaps.gaps.value).toHaveLength(1);
			expect(gap.fetching).toBe(false);
		});

		test('sinceId のノートがキューにいる「現在まで」のマーカーは、キューを解放してから埋める', async () => {
			const { paginator, gaps, fetchRange } = setup([note('n002'), note('n001')]);
			paginator.enqueue(note('n003'));
			const gap = gaps.openGap()!; // sinceId = n003 (キュー側)
			expect(ids(gaps.displayItems.value)).toEqual(['gap:0', 'n002', 'n001']);

			fetchRange.mockResolvedValueOnce([note('n004')]);
			await gaps.fill(gap);
			expect(paginator.queuedAheadItemsCount.value).toBe(0);
			expect(ids(paginator.items.value)).toEqual(['n004', 'n003', 'n002', 'n001']);
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('sinceId のノートが trim 等で消えていればマーカーを捨てる', async () => {
			const { gaps, fetchRange } = setup([note('n003'), note('n002'), note('n001')]);
			const gap = gaps.openGap({ sinceId: 'n050', untilId: 'n060' })!;
			await gaps.fill(gap);
			expect(fetchRange).not.toHaveBeenCalled();
			expect(gaps.gaps.value).toHaveLength(0);
		});

		test('fetch 中の二重呼び出しは無視される', async () => {
			const { gaps, fetchRange } = setup([note('n003'), note('n002'), note('n001')]);
			const gap = gaps.openGap({ sinceId: 'n002', untilId: 'n003' })!;
			let resolve!: (v: Note[]) => void;
			fetchRange.mockReturnValueOnce(new Promise<Note[]>(r => { resolve = r; }));
			const first = gaps.fill(gap);
			expect(gap.fetching).toBe(true);
			await gaps.fill(gap);
			expect(fetchRange).toHaveBeenCalledTimes(1);
			resolve([]);
			await first;
			expect(gaps.gaps.value).toHaveLength(0);
		});
	});

	describe('onNoteRemoved', () => {
		test('sinceId のノートが削除されたら 1 つ古いノートに付け替える', () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			gaps.onNoteRemoved('n002');
			paginator.removeItem('n002');
			expect(gaps.gaps.value[0]!.sinceId).toBe('n001');
			expect(ids(gaps.displayItems.value)).toEqual(['n003', 'gap:0', 'n001']);
		});

		test('付け替え先が無ければマーカーを捨てる', () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n001', untilId: 'n002' });
			gaps.onNoteRemoved('n001');
			paginator.removeItem('n001');
			expect(gaps.gaps.value).toHaveLength(0);
		});
	});

	describe('reset', () => {
		test('paginator.fetching が立ったら (init / reload) マーカーを全部捨てる', async () => {
			const { paginator, gaps } = setup([note('n003'), note('n002'), note('n001')]);
			gaps.openGap({ sinceId: 'n002', untilId: 'n003' });
			expect(gaps.gaps.value).toHaveLength(1);
			paginator.fetching.value = true;
			await nextTick();
			expect(gaps.gaps.value).toHaveLength(0);
		});
	});

	test('isTimelineGap はマーカーとノートを判別する', () => {
		const gap: TimelineGap = { id: 'gap:x', createdAt: '', _type: 'gap', sinceId: 'a', untilId: null, fetching: false, autoFillPending: false };
		expect(isTimelineGap(gap)).toBe(true);
		expect(isTimelineGap(note('n001'))).toBe(false);
	});
});
