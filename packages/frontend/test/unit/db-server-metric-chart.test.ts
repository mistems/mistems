/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { buildDbServerMetricPoints } from '@/utility/db-server-metric-chart.js';

const now = 1_000_000;
const sec = 1000;

describe('DB サーバーメトリクスのグラフの点', () => {
	test('点が無ければ何も描かない', () => {
		expect(buildDbServerMetricPoints([], now, 50, 30)).toEqual([]);
	});

	test('時刻で横の位置が決まり、2 秒で 1 単位ずれる。最後の点から右端までは最後の値を保つ', () => {
		const points = buildDbServerMetricPoints([
			{ time: now - 60 * sec, value: 0.5 },
			{ time: now - 20 * sec, value: 1 },
		], now, 50, 30);
		expect(points).toEqual([[20, 15], [40, 0], [50, 0]]);
	});

	test('時間がたつと同じ点が左へ流れる', () => {
		const samples = [{ time: now - 20 * sec, value: 0 }];
		expect(buildDbServerMetricPoints(samples, now, 50, 30)[0][0]).toBe(40);
		expect(buildDbServerMetricPoints(samples, now + 4 * sec, 50, 30)[0][0]).toBe(38);
	});

	test('左端より古い点は、次の点との間を左端で補間する', () => {
		const points = buildDbServerMetricPoints([
			{ time: now - 120 * sec, value: 0 },
			{ time: now - 80 * sec, value: 1 },
		], now, 50, 30);
		// 左端 (100 秒前) はちょうど中間なので 0.5
		expect(points).toEqual([[0, 15], [10, 0], [50, 0]]);
	});

	test('すべての点が左端より古ければ、最後の値で幅いっぱいに引く', () => {
		expect(buildDbServerMetricPoints([
			{ time: now - 300 * sec, value: 0.2 },
			{ time: now - 200 * sec, value: 0.5 },
		], now, 50, 30)).toEqual([[0, 15], [50, 15]]);
	});

	test('端末の時計が遅れていて未来の点になっても、右端に収める', () => {
		expect(buildDbServerMetricPoints([
			{ time: now + 10 * sec, value: 0.5 },
		], now, 50, 30)).toEqual([[50, 15]]);
	});
});
