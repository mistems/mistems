/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type RotateDirection = 'left' | 'right';

export type RotationTransform = {
	/** 回転後の幅 */
	width: number;
	/** 回転後の高さ */
	height: number;
	translateX: number;
	translateY: number;
	/** ラジアン。canvas は y 軸が下向きなので、正の値が時計回り */
	angle: number;
};

const LOSSY_QUALITY = 0.92;

/**
 * 幅 width・高さ height の画像を 90° 回すときの、canvas の大きさと変換を返す。
 * right は時計回り、left は反時計回りに回す。
 */
export function getRotationTransform(width: number, height: number, direction: RotateDirection): RotationTransform {
	if (direction === 'right') {
		return { width: height, height: width, translateX: height, translateY: 0, angle: Math.PI / 2 };
	} else {
		return { width: height, height: width, translateX: 0, translateY: width, angle: -Math.PI / 2 };
	}
}

/**
 * 画像ファイルを 90° 回し、同じファイル名・同じ形式の新しいファイルを返す。
 * EXIF の向きは反映してから回すので、見た目の向きを基準に回る。書き出したファイルに EXIF は残らない。
 */
export async function rotateImageFile(file: File, direction: RotateDirection): Promise<File> {
	const bitmap = await window.createImageBitmap(file, { imageOrientation: 'from-image' });

	try {
		const t = getRotationTransform(bitmap.width, bitmap.height, direction);

		const canvas = window.document.createElement('canvas');
		canvas.width = t.width;
		canvas.height = t.height;
		const ctx = canvas.getContext('2d');
		if (ctx == null) throw new Error('Failed to get 2d context');

		ctx.translate(t.translateX, t.translateY);
		ctx.rotate(t.angle);
		ctx.drawImage(bitmap, 0, 0);

		const quality = file.type === 'image/jpeg' || file.type === 'image/webp' ? LOSSY_QUALITY : undefined;
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob == null) {
					reject(new Error('Failed to convert canvas to blob'));
				} else {
					resolve(blob);
				}
			}, file.type, quality);
		});

		return new File([blob], file.name, { type: blob.type });
	} finally {
		bitmap.close();
	}
}
