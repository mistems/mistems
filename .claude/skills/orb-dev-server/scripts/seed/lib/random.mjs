/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 開発用シード向けの乱数。mulberry32 で、同じシード値なら同じ列を返す。

export function createRandom(seed) {
	let state = seed >>> 0;

	function next() {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	return {
		next,
		// min 以上 max 以下の整数
		int(min, max) {
			return min + Math.floor(next() * (max - min + 1));
		},
		pick(items) {
			return items[Math.floor(next() * items.length)];
		},
		chance(p) {
			return next() < p;
		},
	};
}
