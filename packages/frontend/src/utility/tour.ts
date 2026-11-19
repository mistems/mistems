/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, ref, shallowRef, defineAsyncComponent, watch } from 'vue';
import * as os from '@/os.js';

export type TourStep = {
	title: string;
	// 関数を渡すと、ステップを表示するときに文言を作る (読み込んだ件数など、その時の状態を入れられる)
	description: string | (() => string);
	// 関数を渡すと、ステップを表示するときに要素を探す (onEnter で画面が変わったあとの要素を指せる)
	// 配列を返すと、要素をすべて囲む範囲を指す。要素が見つからないときは、画面を暗くせずに吹き出しだけを画面の中央に出す
	element: HTMLElement | HTMLElement[] | null | (() => HTMLElement | HTMLElement[] | null | undefined);
	// ステップを表示する前に呼ぶ。画面の状態を説明に合わせるのに使う
	onEnter?: () => void | Promise<void>;
	// スポットの中を操作できるようにする
	interactive?: boolean;
	// 指す要素でこのイベントが起きたら次へ進む (例: ['click'])。このときは「次」を出さず、スポットの中を操作できる
	advanceOn?: string[];
	// この関数が返す値が変わったら次へ進む (例: 再生速度)。このときは「次」を出さず、スポットの中を操作できる
	advanceOnChange?: () => unknown;
};

export type TourOptions = {
	// 最後のステップ以外に「スキップ」を出す。押すと最後のステップへ飛ぶ
	skippable?: boolean;
	// 最後のステップのボタンの文言 (既定は「完了」)
	doneLabel?: string;
	// 指す要素が画面の外にあるとき、画面の中央までスクロールする
	scrollIntoView?: boolean;
	// 中断すると、ツアーを閉じて終わる (ページから離れたときなどに使う)
	signal?: AbortSignal;
};

// 操作してから次のステップへ進むまでの間
const ADVANCE_DELAY_MS = 400;

function resolveElements(step: TourStep): HTMLElement[] {
	const element = typeof step.element === 'function' ? step.element() : step.element;
	if (element == null) return [];
	return Array.isArray(element) ? element : [element];
}

function resolveDescription(step: TourStep): string {
	return typeof step.description === 'function' ? step.description() : step.description;
}

// 指す要素を画面の中央に寄せる。
// 画面より背の高い要素 (タイムライン全体など) は、中央に寄せると途中までスクロールしてしまうので、
// 上の端が見えていればそのままにし、見えていなければ上の端に合わせる
function scrollToElement(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	const viewportHeight = window.innerHeight;
	if (rect.height < viewportHeight) {
		element.scrollIntoView({ block: 'center' });
		return;
	}
	if (rect.top >= 0 && rect.top < viewportHeight) return;
	element.scrollIntoView({ block: 'start' });
}

/**
 * ツアーを表示する。最後まで進むか、signal で中断されると解決する
 */
export function startTour(steps: TourStep[], options: TourOptions = {}) {
	return new Promise<void>((resolve) => {
		const currentStepIndex = ref(0);
		const titleRef = ref(steps[0].title);
		const descriptionRef = ref('');
		const anchorElementRef = shallowRef<HTMLElement | undefined>(undefined);
		const anchorElementsRef = shallowRef<HTMLElement[] | undefined>(undefined);
		const interactiveRef = ref(false);
		const waitForActionRef = ref(false);
		let disposed = false;
		// 操作で次へ進むステップの、イベントの登録を外す関数
		let detachAdvance: (() => void) | null = null;
		let dispose: (() => void) | null = null;
		// ボタンを続けて押したとき、古いステップの onEnter が終わってから表示を上書きしないようにする
		let enterToken = 0;

		async function enter(index: number): Promise<boolean> {
			const token = ++enterToken;
			const step = steps[index];
			await step.onEnter?.();
			await nextTick();
			if (disposed || token !== enterToken) return false;

			detachAdvance?.();
			detachAdvance = null;
			currentStepIndex.value = index;
			titleRef.value = step.title;
			descriptionRef.value = resolveDescription(step);
			const advanceOn = step.advanceOn ?? [];
			const waitForAction = advanceOn.length > 0 || step.advanceOnChange != null;
			interactiveRef.value = (step.interactive ?? false) || waitForAction;
			waitForActionRef.value = waitForAction;
			const elements = resolveElements(step);
			// 並んだ要素 (読み込まれたノートなど) を指すときは、いまの位置のままにする。画面の外へはみ出す分は見切れてよい
			if (elements.length === 1 && options.scrollIntoView) {
				scrollToElement(elements[0]);
			}
			anchorElementRef.value = elements.length === 1 ? elements[0] : undefined;
			anchorElementsRef.value = elements.length > 1 ? elements : undefined;

			// ページ側の処理 (読み込みやスクロール位置の復元など) が落ち着いてから次へ進む
			const onAction = () => {
				window.setTimeout(() => {
					if (currentStepIndex.value === index) goNext();
				}, ADVANCE_DELAY_MS);
			};
			const detachers: (() => void)[] = [];
			if (elements.length > 0 && advanceOn.length > 0) {
				for (const element of elements) {
					for (const type of advanceOn) element.addEventListener(type, onAction);
					detachers.push(() => {
						for (const type of advanceOn) element.removeEventListener(type, onAction);
					});
				}
			}
			if (step.advanceOnChange != null) {
				detachers.push(watch(step.advanceOnChange, onAction));
			}
			if (detachers.length > 0) {
				detachAdvance = () => {
					for (const detach of detachers) detach();
				};
			}
			return true;
		}

		function goNext() {
			if (currentStepIndex.value >= steps.length - 1) {
				finish();
				return;
			}
			enter(currentStepIndex.value + 1);
		}

		function finish() {
			if (disposed) return;
			disposed = true;
			detachAdvance?.();
			dispose?.();
			resolve();
		}

		options.signal?.addEventListener('abort', finish, { once: true });

		// 最初のステップの準備ができてから出す (吹き出しが一瞬あらぬ場所に出ないように)
		enter(0).then((entered) => {
			if (!entered) return;
			dispose = os.popup(defineAsyncComponent(() => import('@/components/MkSpot.vue')), {
				title: titleRef,
				description: descriptionRef,
				anchorElement: anchorElementRef,
				anchorElements: anchorElementsRef,
				interactive: interactiveRef,
				waitForAction: waitForActionRef,
				doneLabel: options.doneLabel,
				hasPrev: computed(() => currentStepIndex.value > 0),
				hasNext: computed(() => currentStepIndex.value < steps.length - 1),
				hasSkip: computed(() => (options.skippable ?? false) && currentStepIndex.value < steps.length - 1),
			}, {
				next: goNext,
				prev: () => {
					enter(currentStepIndex.value - 1);
				},
				skip: () => {
					enter(steps.length - 1);
				},
			}).dispose;
		});
	});
}
