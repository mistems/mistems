/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MISTEMS: iOS の PWA で、アプリを切り替えて戻ったときに画面が上へずれる問題を調べるための表示とログ。
 * 開発者モード (設定 > その他) が有効なときだけ動く。
 *
 * - 画面の左下に、ビューポートまわりの値と直前のイベントを出す。ずれたときにスクリーンショットを撮れば値が残る
 * - イベントのたびと、値が変わったとき (1 秒ごとに確かめる) に、値をログに足す。ログは localStorage に直近 LOG_LIMIT 件を残すので、読み込み直しても消えない
 * - Safari の Web インスペクタからは window.__mistemsViewportLog() でログを読める
 *
 * 調べ終わったら、このファイルと boot/common.ts の呼び出しを消す。
 */

import { IOS_VIEWPORT_RESET_EVENT } from '@/utility/ios-viewport-guard.js';

const STORAGE_KEY = 'mistems:viewportDebugLog';
const LOG_LIMIT = 100;
const POLL_INTERVAL = 1000;

type Snapshot = Record<string, string | number>;
type LogEntry = { t: string; ev: string; s: Snapshot };

function readLog(): LogEntry[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw != null ? JSON.parse(raw) as LogEntry[] : [];
	} catch {
		return [];
	}
}

function writeLog(log: LogEntry[]): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(-LOG_LIMIT)));
	} catch {
		// 保存できなくても表示は続ける
	}
}

export function installViewportDebug(): () => void {
	const probe = window.document.createElement('div');
	probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0';
	const panel = window.document.createElement('div');
	panel.style.cssText = 'position:fixed;left:4px;bottom:calc(env(safe-area-inset-bottom) + 72px);z-index:2147483647;max-width:calc(100vw - 8px);background:rgba(0,0,0,.75);color:#0f0;font:10px/1.3 monospace;padding:4px;pointer-events:none;white-space:pre-wrap;word-break:break-all';
	window.document.body.appendChild(probe);
	window.document.body.appendChild(panel);

	const snapshot = (): Snapshot => {
		const vv = window.visualViewport;
		const de = window.document.documentElement;
		const cs = window.getComputedStyle(probe);
		const appRect = window.document.getElementById('misskey_app')?.getBoundingClientRect();
		return {
			vis: window.document.visibilityState,
			scrollY: window.scrollY,
			sTop: window.document.scrollingElement?.scrollTop ?? -1,
			vvTop: vv != null ? Math.round(vv.offsetTop) : -1,
			vvPageTop: vv != null ? Math.round(vv.pageTop) : -1,
			vvH: vv != null ? Math.round(vv.height) : -1,
			innerH: window.innerHeight,
			outerH: window.outerHeight,
			clientH: de.clientHeight,
			scrollH: de.scrollHeight,
			screenH: window.screen.height,
			safeT: cs.paddingTop,
			safeB: cs.paddingBottom,
			appTop: appRect != null ? Math.round(appRect.top) : -1,
			appH: appRect != null ? Math.round(appRect.height) : -1,
			standalone: window.matchMedia('(display-mode: standalone)').matches ? 1 : 0,
		};
	};

	const log = readLog();
	let last = '';

	const render = (s: Snapshot) => {
		const recent = log.slice(-6).reverse().map(e => `${e.t.slice(11, 19)} ${e.ev}`).join(' / ');
		panel.textContent = Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' ') + '\n' + recent;
	};

	const record = (ev: string) => {
		const s = snapshot();
		last = JSON.stringify(s);
		log.push({ t: new Date().toISOString(), ev, s });
		if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
		writeLog(log);
		render(s);
	};

	const winEvents = ['pageshow', 'pagehide', 'focus', 'blur', 'resize', 'orientationchange', 'scroll', IOS_VIEWPORT_RESET_EVENT] as const;
	const onWin = (e: Event) => record(e.type);
	const onVis = () => record(`vis:${window.document.visibilityState}`);
	const onVvResize = () => record('vv:resize');
	const onVvScroll = () => record('vv:scroll');

	for (const n of winEvents) window.addEventListener(n, onWin, { passive: true });
	window.document.addEventListener('visibilitychange', onVis);
	window.visualViewport?.addEventListener('resize', onVvResize);
	window.visualViewport?.addEventListener('scroll', onVvScroll);

	// イベントを伴わずに値が変わる場合に備えて、定期的に確かめる
	const timer = window.setInterval(() => {
		if (JSON.stringify(snapshot()) !== last) record('change');
	}, POLL_INTERVAL);

	(window as unknown as { __mistemsViewportLog?: () => LogEntry[] }).__mistemsViewportLog = () => readLog();

	record('boot');

	return () => {
		for (const n of winEvents) window.removeEventListener(n, onWin);
		window.document.removeEventListener('visibilitychange', onVis);
		window.visualViewport?.removeEventListener('resize', onVvResize);
		window.visualViewport?.removeEventListener('scroll', onVvScroll);
		window.clearInterval(timer);
		probe.remove();
		panel.remove();
	};
}
