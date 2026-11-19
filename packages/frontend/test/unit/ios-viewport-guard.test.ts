/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { assert, describe, test } from 'vitest';
import { isIosLike, shouldResetDocumentScroll } from '@/utility/ios-viewport-guard.js';

describe('isIosLike', () => {
	test('iPhone の UA を iOS とみなす', () => {
		assert.isTrue(isIosLike('Mozilla/5.0 (iPhone; CPU iPhone OS 27_3 like Mac OS X) AppleWebKit/605.1.15', 5));
	});

	test('タッチ点のある Mac の UA を iPadOS とみなす', () => {
		assert.isTrue(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5));
	});

	test('タッチ点のない Mac は iOS とみなさない', () => {
		assert.isFalse(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0));
	});

	test('Android は iOS とみなさない', () => {
		assert.isFalse(isIosLike('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', 5));
	});
});

describe('shouldResetDocumentScroll', () => {
	test('ずれていなければ戻さない', () => {
		assert.isFalse(shouldResetDocumentScroll({ scrollY: 0, viewportOffsetTop: 0, layoutHeight: 800, visualHeight: 800 }));
	});

	test('キーボードが出ていないのにドキュメントがスクロールしていたら戻す', () => {
		assert.isTrue(shouldResetDocumentScroll({ scrollY: 59, viewportOffsetTop: 0, layoutHeight: 800, visualHeight: 800 }));
	});

	test('キーボードが出ていないのにビジュアルビューポートがずれていたら戻す', () => {
		assert.isTrue(shouldResetDocumentScroll({ scrollY: 0, viewportOffsetTop: 59, layoutHeight: 800, visualHeight: 800 }));
	});

	test('キーボードが出ている間は、iOS が入力欄を見せるためのずれなので戻さない', () => {
		assert.isFalse(shouldResetDocumentScroll({ scrollY: 120, viewportOffsetTop: 120, layoutHeight: 800, visualHeight: 450 }));
	});
});
