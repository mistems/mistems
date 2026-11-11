/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 依存なしの PNG エンコーダと、シード文字列から決まる画像の生成関数。

import zlib from 'node:zlib';
import { createRandom } from './random.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
	const typeBuf = Buffer.from(type, 'latin1');
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	typeBuf.copy(out, 4);
	data.copy(out, 8);
	out.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
	return out;
}

// RGBA (8bit) の PNG を作る。フィルタは全行 0。
export function encodePng(width, height, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // ビット深度
	ihdr[9] = 6; // RGBA
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

// 文字列から 32bit のシード値を作る (FNV-1a)
function hashSeed(seed) {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function hslToRgb(h, s, l) {
	const k = (n) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function randomColor(rnd, s = 0.65, l = 0.55) {
	return hslToRgb(rnd.int(0, 359), s, l);
}

function createCanvas(width, height) {
	const data = new Uint8Array(width * height * 4);
	return {
		data,
		set(x, y, [r, g, b], a = 255) {
			const i = (y * width + x) * 4;
			data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
		},
	};
}

function fillRect(canvas, width, x0, y0, w, h, color) {
	for (let y = y0; y < y0 + h; y++) {
		for (let x = x0; x < x0 + w; x++) canvas.set(x, y, color);
	}
}

// 256x256。5x5 の左右対称ドット絵 (ブロックごとに 1 色)
export function avatarPng(seed) {
	const rnd = createRandom(hashSeed(`avatar:${seed}`));
	const size = 256;
	const cell = 40;
	const offset = (size - cell * 5) / 2;
	const canvas = createCanvas(size, size);
	fillRect(canvas, size, 0, 0, size, size, randomColor(rnd, 0.35, 0.88));
	const fg = randomColor(rnd, 0.7, 0.45);
	for (let row = 0; row < 5; row++) {
		for (let col = 0; col < 3; col++) {
			if (!rnd.chance(0.55)) continue;
			fillRect(canvas, size, offset + col * cell, offset + row * cell, cell, cell, fg);
			fillRect(canvas, size, offset + (4 - col) * cell, offset + row * cell, cell, cell, fg);
		}
	}
	return encodePng(size, size, canvas.data);
}

function gradient(width, height, rnd) {
	const canvas = createCanvas(width, height);
	const h1 = rnd.int(0, 359);
	const h2 = (h1 + rnd.int(40, 140)) % 360;
	const c1 = hslToRgb(h1, 0.7, 0.6);
	const c2 = hslToRgb(h2, 0.7, 0.5);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const t = (x / (width - 1) + y / (height - 1)) / 2;
			canvas.set(x, y, c1.map((v, i) => Math.round(v + (c2[i] - v) * t)));
		}
	}
	return canvas;
}

// 1500x500 の斜めグラデーション
export function bannerPng(seed) {
	const canvas = gradient(1500, 500, createRandom(hashSeed(`banner:${seed}`)));
	return encodePng(1500, 500, canvas.data);
}

// 128x128。透過背景に円と中心の点
export function emojiPng(seed) {
	const rnd = createRandom(hashSeed(`emoji:${seed}`));
	const size = 128;
	const canvas = createCanvas(size, size);
	const body = randomColor(rnd, 0.8, 0.6);
	const dot = randomColor(rnd, 0.8, 0.25);
	const cx = (size - 1) / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = Math.hypot(x - cx, y - cx);
			if (d <= 56) canvas.set(x, y, d <= 16 ? dot : body);
		}
	}
	return encodePng(size, size, canvas.data);
}

// 800x600。グラデーションに矩形をいくつか重ねた添付画像
export function photoPng(seed) {
	const rnd = createRandom(hashSeed(`photo:${seed}`));
	const w = 800;
	const h = 600;
	const canvas = gradient(w, h, rnd);
	for (let i = 0; i < 6; i++) {
		const rw = rnd.int(80, 300);
		const rh = rnd.int(60, 220);
		fillRect(canvas, w, rnd.int(0, w - rw), rnd.int(0, h - rh), rw, rh, randomColor(rnd));
	}
	return encodePng(w, h, canvas.data);
}
