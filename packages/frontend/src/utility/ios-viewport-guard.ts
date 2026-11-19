/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MISTEMS: iOS で、アプリを切り替えて戻ったときに画面が上へずれたままになる問題への対処。
 *
 * - Misskey の画面は 100dvh のルートの中でスクロールし、ドキュメント自体はスクロールしない作りである
 * - ところが iOS (特にホーム画面に追加した PWA) は、アプリの切り替えやキーボードの開け閉めのあとに、
 *   ドキュメントのスクロール位置 (またはビジュアルビューポートの位置) をずらしたまま戻さないことがある
 * - するとヘッダーがステータスバーの裏に隠れ、画面の下にはルートの外側の背景が帯になって見える
 *
 * ドキュメントがスクロールしているのに、キーボードが出ていないときだけ、スクロール位置を 0 に戻す。
 * キーボードが出ている間は、入力欄を見せるために iOS がずらしているので触らない。
 */

/** キーボードが出ているとみなす、レイアウトビューポートとビジュアルビューポートの高さの差 (px) */
const KEYBOARD_THRESHOLD = 100;

/** キーボードの開け閉めや画面の復帰のアニメーションが終わるのを待つ時間 (ms) */
const SETTLE_DELAY = 300;

/** スクロール位置を戻したときに window へ送るイベントの名前 */
export const IOS_VIEWPORT_RESET_EVENT = 'mistems:ios-viewport-reset';

export function isIosLike(ua: string, maxTouchPoints: number): boolean {
	// iPadOS はデスクトップ表示の既定では UA が Mac と同じなので、タッチ点の数で見分ける
	return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function shouldResetDocumentScroll(state: {
	scrollY: number;
	viewportOffsetTop: number;
	layoutHeight: number;
	visualHeight: number;
}): boolean {
	if (state.scrollY === 0 && state.viewportOffsetTop === 0) return false;
	// キーボードが出ている (ビジュアルビューポートだけが縮んでいる) 間は、iOS が入力欄を見せるためにずらしている
	const keyboardShown = state.layoutHeight - state.visualHeight > KEYBOARD_THRESHOLD;
	return !keyboardShown;
}

export function installIosViewportGuard(): void {
	if (!isIosLike(navigator.userAgent, navigator.maxTouchPoints)) return;

	const reset = () => {
		const vv = window.visualViewport;
		const shouldReset = shouldResetDocumentScroll({
			scrollY: window.scrollY,
			viewportOffsetTop: vv?.offsetTop ?? 0,
			layoutHeight: window.document.documentElement.clientHeight,
			visualHeight: vv?.height ?? window.document.documentElement.clientHeight,
		});
		if (shouldReset) {
			window.scrollTo(0, 0);
			// 調査用の表示 (utility/viewport-debug.ts) に、戻したことを知らせる
			window.dispatchEvent(new Event(IOS_VIEWPORT_RESET_EVENT));
		}
	};

	let timer: number | null = null;
	/**
	 * 落ち着いてからスクロール位置を確かめる。
	 * immediate のときは、すぐにも 1 回確かめる (画面の復帰直後は、ビューポートの大きさがまだ切り替わっている途中のことがある)。
	 * キーボードの開け閉めの途中ではビューポートの高さの差が小さく、キーボードが出ていないように見えるので、immediate にしない。
	 */
	const scheduleReset = (immediate: boolean) => {
		if (timer != null) window.clearTimeout(timer);
		if (immediate) reset();
		timer = window.setTimeout(() => {
			timer = null;
			reset();
		}, SETTLE_DELAY);
	};

	window.document.addEventListener('visibilitychange', () => {
		if (window.document.visibilityState === 'visible') scheduleReset(true);
	});
	window.addEventListener('pageshow', () => scheduleReset(true));
	window.addEventListener('focus', () => scheduleReset(true));
	window.addEventListener('resize', () => scheduleReset(false));
	window.visualViewport?.addEventListener('resize', () => scheduleReset(false));
	// キーボードを閉じたあとにずれが残る場合に備える
	window.document.addEventListener('focusout', () => scheduleReset(false));
	// 上のきっかけのあとにずれた場合に備える。
	// ドキュメント自体のスクロール (要素のスクロールは window まで伝わらない) と、指を離したときにも確かめる。
	// ずれた状態では html の overscroll-behavior: none のため、指でスクロールしても戻せないので、
	// 上へスクロールしようとして指を離したところで戻す
	window.addEventListener('scroll', () => scheduleReset(false), { passive: true });
	window.addEventListener('touchend', () => scheduleReset(false), { passive: true });
}
