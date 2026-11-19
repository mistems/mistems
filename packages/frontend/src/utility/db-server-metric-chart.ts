/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * サーバーメトリクスのウィジェット (serverStats) は 2 秒ごとに 1 点ずつ足し、横幅 50 で 100 秒ぶんを描く。
 * DB サーバーの統計は 1 分に 1 回しか届かないので、点の数ではなく時刻を横軸にして、同じ速さで流れるようにする
 */
export const DB_SERVER_METRIC_MS_PER_UNIT = 2000;

export type DbServerMetricSample = {
	/** 測定した時刻 (ミリ秒) */
	time: number;
	/** 0〜1 の値 */
	value: number;
};

/**
 * 時刻を横軸にした折れ線の点を作る。
 * 右端が now で、左へ 1 単位ごとに msPerUnit だけ古くなる。
 * 左端より古い点は左端で補間し、最後の点から右端までは最後の値を保つ (次の測定が届くまで)。
 * samples は時刻の古い順に並べて渡す
 */
export function buildDbServerMetricPoints(samples: DbServerMetricSample[], now: number, width: number, height: number, msPerUnit = DB_SERVER_METRIC_MS_PER_UNIT): [number, number][] {
	if (samples.length === 0) return [];

	const toX = (time: number) => Math.min(width - (now - time) / msPerUnit, width);
	const toY = (value: number) => (1 - Math.min(Math.max(value, 0), 1)) * height;

	const points: [number, number][] = [];
	for (let i = 0; i < samples.length; i++) {
		const x = toX(samples[i].time);
		if (x < 0) {
			// 次の点が左端より右にあれば、その間の線が左端を横切る位置を補間する
			const next = samples[i + 1];
			if (next == null) continue;
			const nextX = toX(next.time);
			if (nextX <= 0) continue;
			const ratio = (0 - x) / (nextX - x);
			points.push([0, toY(samples[i].value + (next.value - samples[i].value) * ratio)]);
			continue;
		}
		points.push([x, toY(samples[i].value)]);
	}

	const last = samples[samples.length - 1];
	if (points.length === 0) {
		// すべての点が左端より古い: 最後の値で幅いっぱいに引く
		return [[0, toY(last.value)], [width, toY(last.value)]];
	}
	const lastPoint = points[points.length - 1];
	if (lastPoint[0] < width) points.push([width, lastPoint[1]]);
	return points;
}
