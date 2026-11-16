<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="[$style.root, { [$style.interactive]: interactive }]" :style="{ zIndex }">
	<div :class="[$style.bg]" :style="interactive ? { clipPath: bgClipPath } : undefined"></div>
	<div ref="spotEl" :class="[$style.spot, { [$style.interactive]: interactive, [$style.none]: !hasAnchor }]"></div>
	<div ref="bodyEl" :class="$style.body" class="_panel _shadow">
		<div class="_gaps_s">
			<div><b>{{ title }}</b></div>
			<div :class="$style.description">{{ description }}</div>
			<div class="_buttons">
				<MkButton v-if="hasPrev" small @click="prev"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
				<template v-if="!waitForAction">
					<MkButton v-if="hasNext" small primary @click="next">{{ i18n.ts.next }} <i class="ti ti-arrow-right"></i></MkButton>
					<MkButton v-else small primary @click="next">{{ doneLabel ?? i18n.ts.done }} <i class="ti ti-check"></i></MkButton>
				</template>
				<div v-if="hasSkip" :class="$style.skip">
					<MkButton small @click="skip">{{ i18n.ts.skip }}</MkButton>
				</div>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { calcPopupPosition } from '@/utility/popup-position.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	title: string;
	description: string;
	anchorElement?: HTMLElement;
	// 並んだ複数の要素をまとめて指す。指定すると anchorElement より優先し、要素をすべて囲む範囲を照らす
	anchorElements?: HTMLElement[];
	x?: number;
	y?: number;
	direction?: 'top' | 'bottom' | 'right' | 'left';
	hasPrev: boolean;
	hasNext: boolean;
	hasSkip?: boolean;
	doneLabel?: string;
	// スポットの中を操作できるようにする
	interactive?: boolean;
	// スポットの中の操作で次へ進むので、「次」を出さない
	waitForAction?: boolean;
}>(), {
	direction: 'top',
});

const emit = defineEmits<{
	(prev: 'prev'): void;
	(next: 'next'): void;
	(skip: 'skip'): void;
}>();

function skip() {
	emit('skip');
}

function prev() {
	emit('prev');
}

function next() {
	emit('next');
}

// 指す要素がないときは、画面を暗くせずに吹き出しだけを出す
const hasAnchor = computed(() => props.anchorElement != null || (props.anchorElements != null && props.anchorElements.length > 0));

const rootEl = useTemplateRef('rootEl');
const bodyEl = useTemplateRef('bodyEl');
const spotEl = useTemplateRef('spotEl');
const zIndex = os.claimZIndex('high');
const spotX = ref(0);
const spotY = ref(0);
const spotWidth = ref(0);
const spotHeight = ref(0);

// 操作できるときは、背景のうちスポットの部分をくり抜いて、クリックがスポットの中へ届くようにする
const SPOT_PADDING = 8;
const bgClipPath = computed(() => {
	const x = spotX.value - SPOT_PADDING;
	const y = spotY.value - SPOT_PADDING;
	const w = spotWidth.value + SPOT_PADDING * 2;
	const h = spotHeight.value + SPOT_PADDING * 2;
	return `path(evenodd, "M0 0 H${window.innerWidth} V${window.innerHeight} H0 Z M${x} ${y} h${w} v${h} h${-w} Z")`;
});

function setPosition() {
	if (spotEl.value == null) return;
	if (bodyEl.value == null) return;
	if (props.anchorElements != null && props.anchorElements.length > 0) {
		setPositionForElements(props.anchorElements, bodyEl.value);
		return;
	}
	if (props.anchorElement == null) {
		// 指す要素がないときは、吹き出しを画面の中央に出す
		spotWidth.value = 0;
		spotHeight.value = 0;
		spotX.value = window.innerWidth / 2;
		spotY.value = window.innerHeight / 2;
		bodyEl.value.style.transformOrigin = 'center';
		bodyEl.value.style.left = (window.innerWidth - bodyEl.value.offsetWidth) / 2 + 'px';
		bodyEl.value.style.top = (window.innerHeight - bodyEl.value.offsetHeight) / 2 + window.scrollY + 'px';
		return;
	}

	const rect = props.anchorElement.getBoundingClientRect();
	spotX.value = rect.left;
	spotY.value = rect.top;
	spotWidth.value = rect.width;
	spotHeight.value = rect.height;

	const data = calcPopupPosition(bodyEl.value, {
		anchorElement: props.anchorElement,
		direction: props.direction,
		align: 'center',
		innerMargin: 16,
		x: props.x,
		y: props.y,
	});

	// 画面より大きい要素を指すときは上にも下にも収まらないので、画面の中に収める
	const margin = 8;
	const maxTop = window.scrollY + window.innerHeight - bodyEl.value.offsetHeight - margin;
	const top = Math.max(window.scrollY + margin, Math.min(data.top, maxTop));

	bodyEl.value.style.transformOrigin = data.transformOrigin;
	bodyEl.value.style.left = data.left + 'px';
	bodyEl.value.style.top = top + 'px';
}

// 複数の要素を囲む範囲を照らし、吹き出しはその下 (入らなければ上、どちらにも入らなければ画面の中) に出す
function setPositionForElements(elements: HTMLElement[], body: HTMLElement) {
	const rects = elements.map((element) => element.getBoundingClientRect());
	const left = Math.min(...rects.map((rect) => rect.left));
	const top = Math.min(...rects.map((rect) => rect.top));
	const right = Math.max(...rects.map((rect) => rect.right));
	const bottom = Math.max(...rects.map((rect) => rect.bottom));
	spotX.value = left;
	spotY.value = top;
	spotWidth.value = right - left;
	spotHeight.value = bottom - top;

	const innerMargin = 16;
	const margin = 8;
	const bodyWidth = body.offsetWidth;
	const bodyHeight = body.offsetHeight;
	let bodyTop: number;
	if (bottom + innerMargin + bodyHeight <= window.innerHeight - margin) {
		bodyTop = bottom + innerMargin;
	} else if (top - innerMargin - bodyHeight >= margin) {
		bodyTop = top - innerMargin - bodyHeight;
	} else {
		bodyTop = Math.max(margin, Math.min(top, window.innerHeight - bodyHeight - margin));
	}
	const bodyLeft = Math.max(0, Math.min((left + right) / 2 - bodyWidth / 2, window.innerWidth - bodyWidth));

	body.style.transformOrigin = 'center';
	body.style.left = bodyLeft + window.scrollX + 'px';
	body.style.top = bodyTop + window.scrollY + 'px';
}

let loopHandler: number | null = null;

onMounted(() => {
	nextTick(() => {
		setPosition();

		const loop = () => {
			setPosition();
			loopHandler = window.requestAnimationFrame(loop);
		};

		loop();
	});
});

onUnmounted(() => {
	if (loopHandler != null) window.cancelAnimationFrame(loopHandler);
});
</script>

<style lang="scss" module>
.root {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

// 操作できるときは、くり抜いた背景と吹き出しだけがクリックを受け取る
.root.interactive {
	pointer-events: none;

	> .bg,
	> .body {
		pointer-events: auto;
	}
}

// 説明の改行をそのまま見せる
.description {
	white-space: pre-wrap;
}

// 「スキップ」は進む・戻るのボタンと離して右端に置く
.skip {
	margin-left: auto;
}

.bg {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

.spot {
	--x: v-bind("spotX + 'px'");
	--y: v-bind("spotY + 'px'");
	--width: v-bind("spotWidth + 'px'");
	--height: v-bind("spotHeight + 'px'");
	--padding: 8px;
	position: absolute;
	left: calc(var(--x) - var(--padding));
	top: calc(var(--y) - var(--padding));
	width: calc(var(--width) + var(--padding) * 2);
	height: calc(var(--height) + var(--padding) * 2);
	box-sizing: border-box;
	border: 1px solid transparent;
	border-radius: 8px;
	box-shadow: 0 0 0 9999px #000a;
	transition: left 0.2s ease-out, top 0.2s ease-out, width 0.2s ease-out, height 0.2s ease-out;
	animation: blink 1s infinite;

	&.interactive {
		pointer-events: none;
	}

	&.none {
		display: none;
	}
}

.body {
	position: absolute;
	padding: 16px 20px;
	box-sizing: border-box;
	width: max-content;
	max-width: min(500px, 100vw);
}

@keyframes blink {
	0%, 100% {
		background: color(from var(--MI_THEME-accent) srgb r g b / 0.1);
		border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.75);
	}
	50% {
		background: transparent;
		border: 1px solid transparent;
	}
}
</style>
