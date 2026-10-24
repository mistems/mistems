/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// aidx 形式の ID 生成。packages/backend/src/misc/id/aidx.ts と同じ桁の並びにする。
// 時刻 8 文字 (2000-01-01 からの経過ミリ秒の 36 進数) + node 4 文字 + カウンタ 4 文字

import { randomInt } from 'node:crypto';

const TIME2000 = 946684800000;
const TIME_LENGTH = 8;
const NODE_LENGTH = 4;
const COUNTER_LENGTH = 4;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// node 部はプロセスごとに乱数で 1 回だけ決める
const nodeId = Array.from({ length: NODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function genAidx(timeMs, counter) {
	if (Number.isNaN(timeMs)) throw new Error('Failed to create AIDX: Invalid Date');
	const time = Math.max(timeMs - TIME2000, 0).toString(36).padStart(TIME_LENGTH, '0').slice(-TIME_LENGTH);
	const noise = counter.toString(36).padStart(COUNTER_LENGTH, '0').slice(-COUNTER_LENGTH);
	return time + nodeId + noise;
}
