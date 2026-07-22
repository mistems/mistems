<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<TransitionGroup
	tag="div"
	:enterActiveClass="$style.transition_items_enterActive"
	:leaveActiveClass="$style.transition_items_leaveActive"
	:enterFromClass="$style.transition_items_enterFrom"
	:leaveToClass="$style.transition_items_leaveTo"
	:moveClass="$style.transition_items_move"
	:class="[$style.items, { [$style.dragging]: dragging, [$style.horizontal]: direction === 'horizontal', [$style.vertical]: direction === 'vertical', [$style.withGaps]: withGaps, [$style.canNest]: canNest }]"
>
	<slot name="header"></slot>
	<div
		v-if="modelValue.length === 0"
		:class="$style.emptyDropArea"
		:data-mk-draggable-empty-instance-id="instanceId"
	>
	</div>
	<div
		v-for="(item, i) in modelValue"
		:key="`MkDraggableRoot:${item.id}`"
		:class="[$style.item, { [$style.isDragging]: draggingItemId === item.id, [$style.noTouchScroll]: noTouchScroll }]"
		:data-mk-draggable-item-root="item.id"
		@pointerdown="manualDragStart ? undefined : onPointerDown($event, item)"
		@contextmenu="onContextmenu"
	>
		<div
			:class="[$style.forwardArea, { [$style.dropReady]: isDropReady(item.id, 'forward') }]"
			:data-mk-draggable-area="'forward'"
			:data-mk-draggable-item-id="item.id"
			:data-mk-draggable-instance-id="instanceId"
		></div>
		<div :key="`MkDraggableItem:${item.id}`" style="position: relative; z-index: 0;">
			<slot :item="item" :index="i" :pointerStart="(ev: PointerEvent) => onPointerDown(ev, item)"></slot>
		</div>
		<div
			:class="[$style.backwardArea, { [$style.dropReady]: isDropReady(item.id, 'backward') }]"
			:data-mk-draggable-area="'backward'"
			:data-mk-draggable-item-id="item.id"
			:data-mk-draggable-instance-id="instanceId"
		></div>
	</div>
	<slot name="footer"></slot>
	<div
		v-if="draggingItemForGhost != null"
		key="__mkdraggable_ghost__"
		ref="ghostRef"
		:class="$style.ghost"
		:style="ghostBaseStyle"
	>
		<slot :item="getGhostItem()" :index="-1" :pointerStart="noop"></slot>
	</div>
</TransitionGroup>
</template>

<script lang="ts">
import { ref } from 'vue';

// インスタンス間でドラッグセッションを連携するため module-level に状態を持つ。
// Pointer Events に統一したことで HTML5 drag-and-drop の DataTransfer を介した
// シリアライズが不要になり、ハンドラレジストリ 1 つだけで完結する。
const dragging = ref(false);

// handler は group 不一致等で no-op の場合 false を返す。source 側はこの戻り値を見て
// `removeSourceCallback` の発火可否を決め、別 group へドロップした時の item 消失を防ぐ。
type DropHandler = (item: { id: string }, sourceGroup: string, targetItemId: string, backward: boolean) => boolean;
type EmptyDropHandler = (item: { id: string }, sourceGroup: string) => boolean;
const dropHandlers = new Map<string, DropHandler>();
const emptyDropHandlers = new Map<string, EmptyDropHandler>();

// 全インスタンスが単一の ref を参照するため、変更のたびに各インスタンスの isDropReady が
// 再評価される。現状 MkDraggable が同一画面に大量に存在するケースは限定的なので問題ない。
// インスタンス数が増える場合は per-instance ref への分散を検討する。
const dropTarget = ref<{ instanceId: string; itemId: string; area: 'forward' | 'backward' } | null>(null);
</script>

<script lang="ts" setup generic="T extends { id: string; }">
import { onBeforeUnmount } from 'vue';
import { genId } from '@/utility/id.js';

/**
 * default スロットの `pointerStart` を `manualDragStart=true` のハンドル要素に配線する場合、
 * そのハンドル要素には CSS で `touch-action: none` を指定すること。
 * Pointer Events 仕様 (*1) によりブラウザは pointerdown の瞬間にジェスチャ判定を確定する
 * ため、JS から後で touch-action を書き換えても間に合わない。touch-action: none を予め
 * 指定しておかないと、ハンドルを掴んでから指を縦に動かした瞬間にブラウザがスクロール
 * ジェスチャを始めて pointercancel を投げてくる。
 *
 * *1 https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior
 */
const slots = defineSlots<{
	default(props: { item: T; index: number; pointerStart: (ev: PointerEvent) => void }): any;
	header(): any;
	footer(): any;
}>();

const props = withDefaults(defineProps<{
	modelValue: T[];
	direction: 'horizontal' | 'vertical';
	group?: string | null;
	manualDragStart?: boolean;
	withGaps?: boolean;
	canNest?: boolean;
	noTouchScroll?: boolean;
}>(), {
	group: null,
	manualDragStart: false,
	withGaps: false,
	canNest: false,
	noTouchScroll: false,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: T[]): void;
}>();

const draggingItemId = ref<T['id'] | null>(null);
const instanceId = genId();
const group = props.group ?? instanceId;

function isDropReady(itemId: T['id'], area: 'forward' | 'backward'): boolean {
	const t = dropTarget.value;
	return t != null && t.instanceId === instanceId && t.itemId === itemId && t.area === area;
}

function applyDrop(draggedItem: T, sourceGroup: string, targetItemId: T['id'], backward: boolean): boolean {
	if (sourceGroup !== group || draggedItem.id === targetItemId) return false;

	const fromIndex = props.modelValue.findIndex(x => x.id === draggedItem.id);
	let toIndex = props.modelValue.findIndex(x => x.id === targetItemId);

	const newValue = [...props.modelValue];
	if (fromIndex > -1) newValue.splice(fromIndex, 1);
	toIndex = newValue.findIndex(x => x.id === targetItemId);
	if (backward) toIndex += 1;
	newValue.splice(toIndex, 0, draggedItem);

	emit('update:modelValue', newValue);
	return true;
}

// ---------- auto-scroll ----------
// Pointer Events では HTML5 D&D のネイティブオートスクロールが効かないため、
// ポインタがスクロール可能な祖先要素の端に近いとき rAF ループで自動スクロールする。

const AUTOSCROLL_EDGE_PX = 40;
const AUTOSCROLL_MAX_SPEED_PX = 15;

let autoScrollTarget: Element | null = null;
let autoScrollRafId: number | null = null;
let autoScrollSpeedX = 0;
let autoScrollSpeedY = 0;
let autoScrollStickyTopPx = 0;
let autoScrollStickyBottomPx = 0;

function findScrollableAncestor(el: Element): Element | null {
	let current = el.parentElement;
	while (current != null) {
		if (current === window.document.documentElement || current === window.document.body) break;
		const style = window.getComputedStyle(current);
		const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
		const canScrollX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && current.scrollWidth > current.clientWidth;
		if (canScrollY || canScrollX) return current;
		current = current.parentElement;
	}
	const scrollEl = window.document.scrollingElement;
	if (scrollEl != null && scrollEl.scrollHeight > scrollEl.clientHeight) return scrollEl;
	return null;
}

// スクロールコンテナの端を覆う sticky/fixed 要素の厚みを検出する。
// probeY 付近を elementFromPoint で探り、sticky/fixed な祖先があればその厚みを返す。
function detectStickyOffset(target: Element, probeY: number, edge: 'top' | 'bottom'): number {
	const rect = target.getBoundingClientRect();
	const probeX = rect.left + rect.width / 2;
	const clampedY = Math.max(0, Math.min(window.innerHeight - 1, probeY));
	const hit = window.document.elementFromPoint(probeX, clampedY);
	if (hit == null) return 0;

	let el: Element | null = hit;
	while (el != null && el !== target) {
		const pos = window.getComputedStyle(el).position;
		if (pos === 'sticky' || pos === 'fixed') {
			const elRect = el.getBoundingClientRect();
			return Math.max(0, edge === 'top'
				? elRect.bottom - rect.top
				: rect.bottom - elRect.top);
		}
		el = el.parentElement;
	}
	return 0;
}

function detectStickyOffsets(target: Element): { top: number; bottom: number } {
	const rect = target.getBoundingClientRect();
	return {
		top: detectStickyOffset(target, Math.max(0, rect.top) + 2, 'top'),
		bottom: detectStickyOffset(target, Math.min(window.innerHeight - 1, rect.bottom) - 2, 'bottom'),
	};
}

function autoScrollTick() {
	if (autoScrollTarget == null) return;
	if (autoScrollSpeedX !== 0) autoScrollTarget.scrollLeft += autoScrollSpeedX;
	if (autoScrollSpeedY !== 0) autoScrollTarget.scrollTop += autoScrollSpeedY;
	autoScrollRafId = window.requestAnimationFrame(autoScrollTick);
}

function updateAutoScroll(clientX: number, clientY: number) {
	if (autoScrollTarget == null) return;

	const rect = (autoScrollTarget === window.document.scrollingElement || autoScrollTarget === window.document.documentElement)
		? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
		: autoScrollTarget.getBoundingClientRect();

	autoScrollSpeedY = 0;
	autoScrollSpeedX = 0;

	const effectiveTop = rect.top + autoScrollStickyTopPx;
	const effectiveBottom = rect.bottom - autoScrollStickyBottomPx;
	const distTop = clientY - effectiveTop;
	const distBottom = effectiveBottom - clientY;

	if (distTop < AUTOSCROLL_EDGE_PX) {
		autoScrollSpeedY = -AUTOSCROLL_MAX_SPEED_PX * Math.min(1, 1 - distTop / AUTOSCROLL_EDGE_PX);
	} else if (distBottom < AUTOSCROLL_EDGE_PX) {
		autoScrollSpeedY = AUTOSCROLL_MAX_SPEED_PX * Math.min(1, 1 - distBottom / AUTOSCROLL_EDGE_PX);
	}

	const distLeft = clientX - rect.left;
	const distRight = rect.right - clientX;
	if (distLeft < AUTOSCROLL_EDGE_PX) {
		autoScrollSpeedX = -AUTOSCROLL_MAX_SPEED_PX * Math.min(1, 1 - distLeft / AUTOSCROLL_EDGE_PX);
	} else if (distRight < AUTOSCROLL_EDGE_PX) {
		autoScrollSpeedX = AUTOSCROLL_MAX_SPEED_PX * Math.min(1, 1 - distRight / AUTOSCROLL_EDGE_PX);
	}

	if ((autoScrollSpeedX !== 0 || autoScrollSpeedY !== 0) && autoScrollRafId == null) {
		autoScrollRafId = window.requestAnimationFrame(autoScrollTick);
	} else if (autoScrollSpeedX === 0 && autoScrollSpeedY === 0 && autoScrollRafId != null) {
		stopAutoScroll();
	}
}

function stopAutoScroll() {
	if (autoScrollRafId != null) {
		window.cancelAnimationFrame(autoScrollRafId);
		autoScrollRafId = null;
	}
	autoScrollSpeedX = 0;
	autoScrollSpeedY = 0;
}

function teardownAutoScroll() {
	stopAutoScroll();
	autoScrollTarget = null;
	autoScrollStickyTopPx = 0;
	autoScrollStickyBottomPx = 0;
}

// ---------- pointer events ----------

const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_PX = 8;

type Pending = {
	pointerId: number;
	pointerType: string;
	x: number;
	y: number;
	captureTarget: HTMLElement;
	sourceElement: HTMLElement | null;
	item: T;
};

let pending: Pending | null = null;
let longPressTimer: number | null = null;
let dragActive = false;
let dragSession: { item: T; instanceId: string; group: string } | null = null;
const ghostRef = ref<HTMLElement | null>(null);
const draggingItemForGhost = ref<T | null>(null);
const ghostBaseStyle = ref<Record<string, string>>({});
let removeSourceCallback: (() => void) | null = null;
let lastSwapTargetId: string | null = null;
let lastSwapBackward: boolean | null = null;
let lastSwapPointerX = 0;
let lastSwapPointerY = 0;
let lastSwapDeadZone = 0;

// DOM 変更直後はレイアウトが未確定で getBoundingClientRect() が不正確。
// SortableJS の _silent と同様、短時間スワップ判定をスキップする。
const SILENT_AFTER_SWAP_MS = 30;
let silentUntil = 0;

// アニメーション中のアイテム ID を保持。TransitionGroup の move アニメーション
// (150ms) が完了するまで、そのアイテムをスワップ対象から除外する。
const ANIMATION_DURATION_MS = 150;
let animatingItemId: string | null = null;
let animatingTimer: number | null = null;

function noop() {}

function getGhostItem(): T { return draggingItemForGhost.value as T; }

function clearLongPress() {
	if (longPressTimer != null) {
		window.clearTimeout(longPressTimer);
		longPressTimer = null;
	}
}

function onVisibilityChange() {
	if (window.document.visibilityState === 'hidden') {
		cleanup();
	}
}

function detachPointerListeners() {
	window.document.removeEventListener('pointermove', onPointerMove);
	window.document.removeEventListener('pointerup', onPointerUp);
	window.document.removeEventListener('pointercancel', onPointerCancel);
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
}

function releaseCapture() {
	if (pending == null) return;
	try {
		if (pending.captureTarget.hasPointerCapture(pending.pointerId)) {
			pending.captureTarget.releasePointerCapture(pending.pointerId);
		}
	} catch {
		// noop
	}
}

function cleanup() {
	detachPointerListeners();
	releaseCapture();
	clearLongPress();
	teardownAutoScroll();
	const wasTouch = pending?.pointerType === 'touch';
	dragActive = false;
	dragSession = null;
	pending = null;
	dropTarget.value = null;
	dragging.value = false;
	draggingItemId.value = null;
	removeSourceCallback = null;
	lastSwapTargetId = null;
	lastSwapBackward = null;
	lastSwapPointerX = 0;
	lastSwapPointerY = 0;
	lastSwapDeadZone = 0;
	silentUntil = 0;
	if (animatingTimer != null) { window.clearTimeout(animatingTimer); animatingTimer = null; }
	animatingItemId = null;
	draggingItemForGhost.value = null;
	ghostBaseStyle.value = {};
	if (wasTouch) {
		// cleanup の後にも contextmenu が遅延して飛んでくる経路があるため、少し遅らせて外す
		scheduleContextmenuSuppressorRelease();
	}
}

// タッチ長押し中、ブラウザ / OS が contextmenu イベントを投げてくることへの対策。
// 経路がいくつかあって厄介:
//   1. .item div 上の listener で stopPropagation するだけでは pointercancel → cleanup
//      の後に contextmenu が発火するケースで `pending`/`dragActive` が false になっており
//      捕捉できない (祖先の Misskey 共通 contextmenu に到達してしまう)。
//   2. キャプチャ要素の touch-action: none だけでは contextmenu イベント自体は抑止できない。
//   3. Misskey 側の `@contextmenu` リスナーは祖先側 (universal.vue 等) にも複数存在し、
//      .stop 修飾子 (bubble 中の stopPropagation) を尊重して順序通り発火する。
//
// 対策: touch pointerdown と同時に document に capture phase で contextmenu を
// 完全抑止する listener を張り、cleanup 後しばらく ( SUPPRESS_AFTER_CLEANUP_MS )
// 残してから外す。これで上記すべての timing で確実に止められる。
const SUPPRESS_AFTER_CLEANUP_MS = 500;
let contextmenuSuppressorActive = false;
let contextmenuSuppressorTimer: number | null = null;

function suppressContextmenuListener(ev: Event) {
	ev.preventDefault();
	ev.stopImmediatePropagation();
}

function attachContextmenuSuppressor() {
	if (contextmenuSuppressorActive) return;
	contextmenuSuppressorActive = true;
	window.document.addEventListener('contextmenu', suppressContextmenuListener, { capture: true });
}

function scheduleContextmenuSuppressorRelease() {
	if (contextmenuSuppressorTimer != null) {
		window.clearTimeout(contextmenuSuppressorTimer);
	}
	contextmenuSuppressorTimer = window.setTimeout(() => {
		window.document.removeEventListener('contextmenu', suppressContextmenuListener, { capture: true });
		contextmenuSuppressorActive = false;
		contextmenuSuppressorTimer = null;
	}, SUPPRESS_AFTER_CLEANUP_MS);
}

// .item div 上では PC の右クリックも捕まえるので、touch session 外は何もしない。
// (タッチ経路は document の capture phase suppressor 側で抑止される)
function onContextmenu(ev: MouseEvent) {
	if (pending != null || dragActive) {
		ev.preventDefault();
		ev.stopPropagation();
	}
}

function onPointerDown(ev: PointerEvent, item: T) {
	if (pending != null || dragActive) return;
	// mouse は左ボタンだけ受け付ける (右クリックメニュー等を阻害しない)
	if (ev.pointerType === 'mouse' && ev.button !== 0) return;

	// capture / listener 対象は ev.currentTarget (= ハンドル button などの小さい要素) ではなく
	// MkDraggable の `.item` div を選ぶ。これで指がハンドルの矩形を外れても capture が保持され、
	// pointermove が滑らかに届き続ける。また button 固有の implicit pointer release 挙動
	// (focus 抜け・blur 時の解放など) に左右されない。
	//
	// ※ setPointerCapture はここでは呼ばず startDrag() まで遅延する。Pointer Events Level 3
	// ではキャプチャ中に合成される click がキャプチャ要素へリターゲットされるため、
	// pointerdown 時点でキャプチャするとアイテム内のボタン等が「押して離しただけ」でも
	// click を受け取れなくなる (Firefox / Chromium とも実装済みの挙動)。
	const origin = ev.currentTarget as HTMLElement;
	const itemEl = origin.closest<HTMLElement>(`[data-mk-draggable-item-root="${CSS.escape(item.id)}"]`) ?? origin;
	const captureTarget = itemEl;
	const sourceElement = itemEl;

	pending = {
		pointerId: ev.pointerId,
		pointerType: ev.pointerType,
		x: ev.clientX,
		y: ev.clientY,
		captureTarget,
		sourceElement,
		item,
	};

	// 祖先の Misskey 共通コンテキストメニューが暴発しないよう document に capture phase で抑止を張る
	// (詳細は suppressContextmenuListener 付近のコメント参照)
	if (ev.pointerType === 'touch') {
		attachContextmenuSuppressor();
	}

	// captureTarget ではなく document でリッスン。DOM 並び替え (TransitionGroup) で
	// Pointer Capture が暗黙解放されても pointermove を確実に受け取るため。
	window.document.addEventListener('pointermove', onPointerMove);
	window.document.addEventListener('pointerup', onPointerUp);
	window.document.addEventListener('pointercancel', onPointerCancel);
	window.document.addEventListener('visibilitychange', onVisibilityChange);

	if (props.manualDragStart) {
		// ハンドル経由は明示的な意図表明なので即時開始
		startDrag();
	} else if (ev.pointerType === 'touch') {
		// 行全体掴み × touch では touch-action: pan-y がスクロールを横取りするため、
		// 動かしてから開始する方式は構造的に成立しない。SortableJS や iOS の編集モード
		// 等と同じ「長押しで並び替え、動かせばスクロール」の挙動に統一する。
		longPressTimer = window.setTimeout(startDrag, LONG_PRESS_MS);
	}
	// それ以外 (mouse / pen): pointermove で MOVE_THRESHOLD_PX を超えたら開始
}

function startDrag() {
	if (pending == null) return;
	dragActive = true;
	const item = pending.item;
	dragSession = { item, instanceId, group };
	dragging.value = true;
	draggingItemId.value = item.id;

	// ドラッグ確定時点でキャプチャする (pointerdown 時に呼ばない理由は onPointerDown 参照)。
	// ウィンドウ外へのマウス移動でも pointermove が届き続け、ドラッグ終了時の click は
	// リターゲットにより `.item` div へ飛ぶのでアイテム内ボタンの誤発火も防げる。
	try {
		pending.captureTarget.setPointerCapture(pending.pointerId);
	} catch {
		// noop
	}

	// mouse は textnode の選択が始まっていることがあるのでクリアする
	if (pending.pointerType === 'mouse') {
		window.getSelection()?.removeAllRanges();
	}

	removeSourceCallback = () => {
		const newValue = props.modelValue.filter(x => x.id !== item.id);
		emit('update:modelValue', newValue);
	};

	autoScrollTarget = findScrollableAncestor(pending.captureTarget);
	if (autoScrollTarget != null) {
		const offsets = detectStickyOffsets(autoScrollTarget);
		autoScrollStickyTopPx = offsets.top;
		autoScrollStickyBottomPx = offsets.bottom;
	}
	if (pending.pointerType === 'touch' && 'vibrate' in navigator) {
		try {
			navigator.vibrate(30);
		} catch {
			// noop
		}
	}
}

// ---------- same-instance reorder ----------
// ゴースト rect と各アイテムの rect を直接比較してスワップ候補を見つける。
// elementFromPoint を使わないため、透明 overlay の z-index 問題が発生しない。

const OVERLAP_RATIO = 0.3;

function computeOverlap(ghostRect: DOMRect, targetRect: DOMRect, backward: boolean): number {
	if (props.direction === 'horizontal') {
		return backward
			? ghostRect.right - targetRect.left
			: targetRect.right - ghostRect.left;
	}
	return backward
		? ghostRect.bottom - targetRect.top
		: targetRect.bottom - ghostRect.top;
}

function trySameInstanceReorder(ev: PointerEvent, ghostRect: DOMRect | null): boolean {
	if (dragSession == null || ghostRect == null || pending == null) return false;
	const draggedId = dragSession.item.id;
	const container = pending.captureTarget.parentElement;
	if (container == null) return false;

	const draggedIndex = props.modelValue.findIndex(x => x.id === draggedId);
	if (draggedIndex === -1) return false;

	for (let i = 0; i < props.modelValue.length; i++) {
		if (i === draggedIndex) continue;
		const item = props.modelValue[i];
		if (item.id === animatingItemId) continue;

		// :scope > で直下の子に限定 (canNest でネストした別インスタンスの item root を誤って拾わない)
		const itemEl = container.querySelector<HTMLElement>(
			`:scope > [data-mk-draggable-item-root="${CSS.escape(item.id)}"]`,
		);
		if (itemEl == null) continue;

		const itemRect = itemEl.getBoundingClientRect();
		const backward = draggedIndex < i;

		const size = props.direction === 'horizontal'
			? Math.min(ghostRect.width, itemRect.width)
			: Math.min(ghostRect.height, itemRect.height);
		const threshold = size * OVERLAP_RATIO;
		const overlap = computeOverlap(ghostRect, itemRect, backward);
		if (overlap < threshold) continue;

		// オシレーション防止: 同じ相手への逆方向スワップはデッドゾーン内ならブロック
		if (lastSwapTargetId === item.id && lastSwapBackward !== backward) {
			const dist = props.direction === 'horizontal'
				? Math.abs(ev.clientX - lastSwapPointerX)
				: Math.abs(ev.clientY - lastSwapPointerY);
			if (dist < lastSwapDeadZone) return true;
		}

		if (!applyDrop(dragSession.item as T, group, item.id, backward)) continue;

		const now = performance.now();
		silentUntil = now + SILENT_AFTER_SWAP_MS;
		lastSwapTargetId = item.id;
		lastSwapBackward = backward;
		lastSwapPointerX = ev.clientX;
		lastSwapPointerY = ev.clientY;
		lastSwapDeadZone = props.direction === 'horizontal' ? itemRect.width : itemRect.height;

		if (animatingTimer != null) window.clearTimeout(animatingTimer);
		animatingItemId = item.id;
		animatingTimer = window.setTimeout(() => {
			animatingItemId = null;
			animatingTimer = null;
		}, ANIMATION_DURATION_MS);

		return true;
	}
	return false;
}

// ---------- pointer move ----------

function onPointerMove(ev: PointerEvent) {
	if (pending == null || ev.pointerId !== pending.pointerId) return;

	if (!dragActive) {
		const dx = Math.abs(ev.clientX - pending.x);
		const dy = Math.abs(ev.clientY - pending.y);
		const moved = dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX;
		if (!moved) return;

		if (pending.pointerType === 'touch') {
			// 長押し成立前に動いたら通常スクロールに譲る (タッチのみ)
			cleanup();
		} else {
			// mouse / pen: 動き出した瞬間がドラッグ開始トリガー。
			// 動かさず pointerup (=click) は dragActive=false のまま素通し。
			startDrag();
		}
		return;
	}

	// drag 中
	if (pending.pointerType === 'touch') {
		// タッチ時のみ、スクロールへの誤伝播を防ぐため preventDefault。
		// mouse / pen は元々スクロールジェスチャを持たないので不要。
		ev.preventDefault();
	}

	// ゴーストは最初の pointermove で遅延初期化する。startDrag() 時点では生成しないことで、
	// manualDragStart + touch でハンドルをタップしただけ（動かさず離す）のケースで
	// ゴーストが一瞬フラッシュするのを防ぐ。
	if (draggingItemForGhost.value == null && pending.sourceElement != null) {
		const rect = pending.sourceElement.getBoundingClientRect();
		const container = pending.sourceElement.parentElement;

		let cbX = 0;
		let cbY = 0;
		if (container != null) {
			const probe = window.document.createElement('div');
			Object.assign(probe.style, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', visibility: 'hidden' });
			container.appendChild(probe);
			const probeRect = probe.getBoundingClientRect();
			cbX = probeRect.left;
			cbY = probeRect.top;
			probe.remove();
		}

		ghostBaseStyle.value = {
			position: 'fixed',
			top: `${rect.top - cbY}px`,
			left: `${rect.left - cbX}px`,
			width: `${rect.width}px`,
			margin: '0',
			zIndex: '2147483647',
			transformOrigin: 'top left',
			containerType: 'inline-size',
		};
		draggingItemForGhost.value = pending.item;
	}

	if (ghostRef.value != null) {
		const dx = ev.clientX - pending.x;
		const dy = ev.clientY - pending.y;
		ghostRef.value.style.transform = `translate(${dx}px, ${dy}px)`;
	}

	updateAutoScroll(ev.clientX, ev.clientY);

	// DOM 変更直後は座標が不安定なためスワップ判定をスキップ (ゴースト移動・オートスクロールは実行済)
	if (performance.now() < silentUntil) {
		return;
	}

	const ghostRect = ghostRef.value?.getBoundingClientRect() ?? null;

	// 同一インスタンス内の並べ替え: ゴースト rect と各アイテムの rect を直接比較する。
	// elementFromPoint を使わないため、透明な overlay area の z-index 問題やコンテンツ
	// ヒットの問題が発生しない。
	if (trySameInstanceReorder(ev, ghostRect)) {
		dropTarget.value = null;
		return;
	}

	// 異なるインスタンス間のドロップ: elementFromPoint でターゲットを検出する。
	// 他インスタンスのアイテムには直接アクセスできないため、ここだけ elementFromPoint を使う。
	const prevDisplay = ghostRef.value?.style.display ?? '';
	if (ghostRef.value != null) ghostRef.value.style.display = 'none';
	const el = window.document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
	if (ghostRef.value != null) ghostRef.value.style.display = prevDisplay;

	if (el != null) {
		const areaEl = el.closest<HTMLElement>('[data-mk-draggable-area]');
		if (areaEl != null) {
			const targetInstanceId = areaEl.dataset.mkDraggableInstanceId;
			const targetItemId = areaEl.dataset.mkDraggableItemId;
			const area = areaEl.dataset.mkDraggableArea as 'forward' | 'backward' | undefined;
			if (targetInstanceId != null && targetItemId != null && targetInstanceId !== instanceId && (area === 'forward' || area === 'backward')) {
				dropTarget.value = { instanceId: targetInstanceId, itemId: targetItemId, area };
				return;
			}
		}
	}
	dropTarget.value = null;
}

function onPointerUp(ev: PointerEvent) {
	if (pending == null || ev.pointerId !== pending.pointerId) return;

	if (!dragActive) {
		// tap (動かさず離した) のケース: click 合成を妨げないようそのまま終了
		cleanup();
		return;
	}

	const target = dropTarget.value;
	const session = dragSession;

	if (session != null && target != null) {
		const handler = dropHandlers.get(target.instanceId);
		if (handler != null) {
			// target 側で処理が成立した (group 一致等) 場合のみ source から削除
			const accepted = handler(session.item, session.group, target.itemId, target.area === 'backward');
			if (accepted && target.instanceId !== instanceId) {
				removeSourceCallback?.();
			}
		}
	} else if (session != null) {
		// emptyDropArea にドロップしたか確認
		const prevDisplay = ghostRef.value?.style.display ?? '';
		if (ghostRef.value != null) ghostRef.value.style.display = 'none';
		const el = window.document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
		if (ghostRef.value != null) ghostRef.value.style.display = prevDisplay;
		const emptyEl = el?.closest<HTMLElement>('[data-mk-draggable-empty-instance-id]');
		if (emptyEl != null) {
			const targetInstanceId = emptyEl.dataset.mkDraggableEmptyInstanceId;
			if (targetInstanceId != null) {
				const handler = emptyDropHandlers.get(targetInstanceId);
				if (handler != null) {
					const accepted = handler(session.item, session.group);
					if (accepted && targetInstanceId !== instanceId) {
						removeSourceCallback?.();
					}
				}
			}
		}
	}

	cleanup();
}

function onPointerCancel(ev: PointerEvent) {
	if (pending == null || ev.pointerId !== pending.pointerId) return;
	cleanup();
}

// ---------- registry ----------

dropHandlers.set(instanceId, (draggedItem, sourceGroup, targetItemId, backward) => {
	return applyDrop(draggedItem as T, sourceGroup, targetItemId, backward);
});
emptyDropHandlers.set(instanceId, (draggedItem, sourceGroup) => {
	if (sourceGroup !== group) return false;
	emit('update:modelValue', [draggedItem as T]);
	return true;
});

onBeforeUnmount(() => {
	dropHandlers.delete(instanceId);
	emptyDropHandlers.delete(instanceId);
	// 自インスタンスがドラッグ中 / 待機中だった場合はリスナーリーク防止のため cleanup
	if (dragSession?.instanceId === instanceId || pending != null) {
		cleanup();
	}
});
</script>

<style lang="scss" module>
.transition_items_move,
.transition_items_enterActive,
.transition_items_leaveActive {
	transition: all 0.15s ease;
}
.transition_items_enterFrom,
.transition_items_leaveTo {
	opacity: 0;
}
.transition_items_leaveActive {
	position: absolute;
}

.items {
	display: flex;
	align-items: center;
	justify-content: left;
	flex-wrap: wrap;
}

.items.horizontal {
	flex-direction: row;
}
.items.vertical {
	flex-direction: column;
}

.item {
	position: relative;

	// 縦スクロール (= ページスクロール) はブラウザに譲り、それ以外のタッチジェスチャ
	// (横スワイプやピンチズーム等) は抑止する。指を動かせばスクロール、指を止めれば
	// 長押し成立 → 並び替えという直感的な切り替えになる。横方向 MkDraggable でも
	// ページの縦スクロールは通したいので、direction によらず一律 pan-y。
	// ※ 横スクロール可能なコンテナに horizontal MkDraggable を入れる場合は、利用側で
	//   `touch-action` を上書きする必要がある。
	touch-action: pan-y;

	// iOS: 長押し時のコンテキストメニュー (Copy / Define / リンクプレビュー等) を抑止 —
	// 長押しドラッグと競合するため。
	-webkit-touch-callout: none;
}

.isDragging {
	opacity: 0.4;
}

.noTouchScroll {
	touch-action: none;
}

.ghost {
	pointer-events: none;
	opacity: 0.85;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
	transition: transform 0.05s linear;
}

// Ghost は TransitionGroup の enter/leave/move アニメーション対象外にする。
// transition: none にすることで Vue が「遷移なし」と判定し、即座に挿入/除去する。
.transition_items_move.ghost,
.transition_items_enterActive.ghost,
.transition_items_leaveActive.ghost {
	transition: none;
}

.transition_items_enterFrom.ghost,
.transition_items_leaveTo.ghost {
	opacity: 0.85;
}

// タッチデバイスでのみ text selection を抑止 (PC では選択を残す)。
// pointer:coarse + hover:none で touch-primary 端末を判定。
@media (hover: none) and (pointer: coarse) {
	.item {
		-webkit-user-select: none;
		user-select: none;
	}

	// form 要素や contenteditable は子で選択可に戻す
	.item :where(textarea, input, [contenteditable]) {
		-webkit-user-select: auto;
		user-select: auto;
	}
}

.items.vertical .item {
	width: 100%;
}

.items.horizontal.withGaps {
	row-gap: var(--MI-margin);
}

.items.horizontal.withGaps .item {
	padding-left: calc(var(--MI-margin) / 2);
	padding-right: calc(var(--MI-margin) / 2);
}

.items.vertical.withGaps .item {
	padding-top: calc(var(--MI-margin) / 2);
	padding-bottom: calc(var(--MI-margin) / 2);
}

.forwardArea, .backwardArea {
	position: absolute;
	z-index: 1;
	pointer-events: none;
}

.items.dragging {
	.forwardArea, .backwardArea {
		pointer-events: auto;
	}
}

.items.horizontal {
	.forwardArea {
		top: 0;
		left: 0;
		width: 50%;
		height: 100%;
	}

	.backwardArea {
		top: 0;
		right: 0;
		width: 50%;
		height: 100%;
	}
}

.items.vertical {
	.forwardArea {
		top: 0;
		left: 0;
		width: 100%;
		height: 50%;
	}

	.backwardArea {
		bottom: 0;
		left: 0;
		width: 100%;
		height: 50%;
	}
}

.items.canNest.horizontal {
	.forwardArea, .backwardArea {
		width: 30px;
	}
}

.items.canNest.vertical {
	.forwardArea, .backwardArea {
		height: 30px;
	}
}

.dropReady::before {
	content: '';
	position: absolute;
	z-index: 99999;
	background: var(--MI_THEME-accent);
	border-radius: 999px;
	pointer-events: none;
}

.items.horizontal {
	.forwardArea.dropReady::before {
		top: 0;
		left: -1px;
		width: 2px;
		height: 100%;
	}

	.backwardArea.dropReady::before {
		top: 0;
		right: -1px;
		width: 2px;
		height: 100%;
	}
}

.items.vertical {
	.forwardArea.dropReady::before {
		top: -1px;
		left: 0;
		width: 100%;
		height: 2px;
	}

	.backwardArea.dropReady::before {
		bottom: -1px;
		left: 0;
		width: 100%;
		height: 2px;
	}
}

.items.horizontal .emptyDropArea {
	width: 40px;
	height: 40px;
}

.items.vertical .emptyDropArea {
	width: 100%;
	height: 50px;
}
</style>
