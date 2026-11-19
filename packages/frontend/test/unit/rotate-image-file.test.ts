/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getRotationTransform, rotateImageFile } from '@/utility/rotate-image-file.js';

// 変換を点に当てて、回転後の座標を求める (canvas の rotate は y 軸が下向きなので、正の角度が時計回り)
function applyTransform(t: ReturnType<typeof getRotationTransform>, x: number, y: number): [number, number] {
	const cos = Math.round(Math.cos(t.angle));
	const sin = Math.round(Math.sin(t.angle));
	return [x * cos - y * sin + t.translateX, x * sin + y * cos + t.translateY];
}

describe('getRotationTransform', () => {
	test('右に回すと幅と高さが入れ替わる', () => {
		const t = getRotationTransform(300, 600, 'right');
		expect(t.width).toBe(600);
		expect(t.height).toBe(300);
	});

	test('左に回すと幅と高さが入れ替わる', () => {
		const t = getRotationTransform(300, 600, 'left');
		expect(t.width).toBe(600);
		expect(t.height).toBe(300);
	});

	test('右に回すと、元の左上が右上に、左下が左上に来る', () => {
		const t = getRotationTransform(300, 600, 'right');
		expect(applyTransform(t, 0, 0)).toEqual([600, 0]);
		expect(applyTransform(t, 0, 600)).toEqual([0, 0]);
		expect(applyTransform(t, 300, 600)).toEqual([0, 300]);
		expect(applyTransform(t, 300, 0)).toEqual([600, 300]);
	});

	test('左に回すと、元の左上が左下に、右上が左上に来る', () => {
		const t = getRotationTransform(300, 600, 'left');
		expect(applyTransform(t, 0, 0)).toEqual([0, 300]);
		expect(applyTransform(t, 300, 0)).toEqual([0, 0]);
		expect(applyTransform(t, 300, 600)).toEqual([600, 0]);
		expect(applyTransform(t, 0, 600)).toEqual([600, 300]);
	});

	test('右に 4 回回すと元の座標に戻る', () => {
		let point: [number, number] = [10, 20];
		let w = 300;
		let h = 600;
		for (let i = 0; i < 4; i++) {
			const t = getRotationTransform(w, h, 'right');
			point = applyTransform(t, point[0], point[1]);
			w = t.width;
			h = t.height;
		}
		expect(point).toEqual([10, 20]);
		expect([w, h]).toEqual([300, 600]);
	});

	test('右と左を 1 回ずつ回すと元の座標に戻る', () => {
		const r = getRotationTransform(300, 600, 'right');
		const l = getRotationTransform(r.width, r.height, 'left');
		const p = applyTransform(r, 10, 20);
		expect(applyTransform(l, p[0], p[1])).toEqual([10, 20]);
	});
});

describe('rotateImageFile', () => {
	const calls: { method: string; args: unknown[] }[] = [];
	let canvasSize: { width: number; height: number } | null = null;
	let toBlobArgs: unknown[] = [];

	beforeEach(() => {
		calls.length = 0;
		canvasSize = null;
		toBlobArgs = [];

		vi.stubGlobal('createImageBitmap', vi.fn(async (_file: Blob, options: ImageBitmapOptions) => {
			calls.push({ method: 'createImageBitmap', args: [options] });
			return { width: 300, height: 600, close: () => calls.push({ method: 'close', args: [] }) };
		}));

		const originalCreateElement = window.document.createElement.bind(window.document);
		vi.spyOn(window.document, 'createElement').mockImplementation(((tagName: string) => {
			if (tagName !== 'canvas') return originalCreateElement(tagName);
			const ctx = {
				translate: (...args: unknown[]) => calls.push({ method: 'translate', args }),
				rotate: (...args: unknown[]) => calls.push({ method: 'rotate', args }),
				drawImage: (...args: unknown[]) => calls.push({ method: 'drawImage', args }),
			};
			const canvas = {
				width: 0,
				height: 0,
				getContext: () => ctx,
				toBlob: (cb: (blob: Blob | null) => void, type: string, quality?: number) => {
					canvasSize = { width: canvas.width, height: canvas.height };
					toBlobArgs = [type, quality];
					cb(new Blob(['rotated'], { type }));
				},
			};
			return canvas as unknown as HTMLElement;
		}) as typeof window.document.createElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test('ファイル名と形式を保ち、幅と高さを入れ替えた canvas に描く', async () => {
		const file = new File(['x'], 'photo.png', { type: 'image/png' });
		const rotated = await rotateImageFile(file, 'right');

		expect(rotated).toBeInstanceOf(File);
		expect(rotated.name).toBe('photo.png');
		expect(rotated.type).toBe('image/png');
		expect(canvasSize).toEqual({ width: 600, height: 300 });
		expect(calls.find(c => c.method === 'translate')?.args).toEqual([600, 0]);
		expect(calls.find(c => c.method === 'rotate')?.args).toEqual([Math.PI / 2]);
		expect(calls.find(c => c.method === 'drawImage')?.args.slice(1)).toEqual([0, 0]);
		// PNG は品質を指定しない
		expect(toBlobArgs).toEqual(['image/png', undefined]);
	});

	test('EXIF の向きを反映して読み込み、読み込んだ画像を閉じる', async () => {
		const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
		await rotateImageFile(file, 'left');

		expect(calls[0]).toEqual({ method: 'createImageBitmap', args: [{ imageOrientation: 'from-image' }] });
		expect(calls.some(c => c.method === 'close')).toBe(true);
		expect(calls.find(c => c.method === 'translate')?.args).toEqual([0, 300]);
		expect(calls.find(c => c.method === 'rotate')?.args).toEqual([-Math.PI / 2]);
	});

	test('JPEG と WebP は高めの品質で書き出す', async () => {
		await rotateImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'right');
		expect(toBlobArgs).toEqual(['image/jpeg', 0.92]);

		await rotateImageFile(new File(['x'], 'a.webp', { type: 'image/webp' }), 'right');
		expect(toBlobArgs).toEqual(['image/webp', 0.92]);
	});
});
