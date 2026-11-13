<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<svg :viewBox="`0 0 ${ viewBoxX } ${ viewBoxY }`">
		<defs>
			<linearGradient :id="cpuGradientId" x1="0" x2="0" y1="1" y2="0">
				<stop offset="0%" stop-color="hsl(180, 80%, 70%)"></stop>
				<stop offset="100%" stop-color="hsl(0, 80%, 70%)"></stop>
			</linearGradient>
			<mask :id="cpuMaskId" x="0" y="0" :width="viewBoxX" :height="viewBoxY">
				<polygon :points="cpuPolygonPoints" fill="#fff" fill-opacity="0.5"/>
				<polyline :points="cpuPolylinePoints" fill="none" stroke="#fff" stroke-width="1"/>
			</mask>
		</defs>
		<rect
			x="-2" y="-2"
			:width="viewBoxX + 4" :height="viewBoxY + 4"
			:style="{ stroke: 'none', fill: `url(#${ cpuGradientId })`, mask: `url(#${ cpuMaskId })` }"
		/>
		<text x="1" y="5">CPU <tspan>{{ cpuP }}%</tspan></text>
	</svg>
	<svg :viewBox="`0 0 ${ viewBoxX } ${ viewBoxY }`">
		<defs>
			<linearGradient :id="memGradientId" x1="0" x2="0" y1="1" y2="0">
				<stop offset="0%" stop-color="hsl(180, 80%, 70%)"></stop>
				<stop offset="100%" stop-color="hsl(0, 80%, 70%)"></stop>
			</linearGradient>
			<mask :id="memMaskId" x="0" y="0" :width="viewBoxX" :height="viewBoxY">
				<polygon :points="memPolygonPoints" fill="#fff" fill-opacity="0.5"/>
				<polyline :points="memPolylinePoints" fill="none" stroke="#fff" stroke-width="1"/>
			</mask>
		</defs>
		<rect
			x="-2" y="-2"
			:width="viewBoxX + 4" :height="viewBoxY + 4"
			:style="{ stroke: 'none', fill: `url(#${ memGradientId })`, mask: `url(#${ memMaskId })` }"
		/>
		<text x="1" y="5">MEM <tspan>{{ memP }}%</tspan></text>
	</svg>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { genId } from '@/utility/id.js';

const props = defineProps<{
	history: Misskey.entities.DbServerStats[];
}>();

const viewBoxX = 50;
const viewBoxY = 30;
const cpuGradientId = genId();
const cpuMaskId = genId();
const memGradientId = genId();
const memMaskId = genId();

const recent = computed(() => props.history.slice(-50));

const cpuRatios = computed(() => recent.value.map(s => s.cpu ?? 0));
const memRatios = computed(() => recent.value.map(s => {
	if (s.memUsed == null || s.memTotal == null || s.memTotal === 0) return 0;
	return s.memUsed / s.memTotal;
}));

const cpuPolylinePoints = computed(() =>
	cpuRatios.value
		.map((r, i) => `${viewBoxX - (cpuRatios.value.length - 1 - i)},${(1 - r) * viewBoxY}`)
		.join(' '),
);
const memPolylinePoints = computed(() =>
	memRatios.value
		.map((r, i) => `${viewBoxX - (memRatios.value.length - 1 - i)},${(1 - r) * viewBoxY}`)
		.join(' '),
);
const cpuPolygonPoints = computed(() => `${viewBoxX - (cpuRatios.value.length - 1)},${viewBoxY} ${cpuPolylinePoints.value} ${viewBoxX},${viewBoxY}`);
const memPolygonPoints = computed(() => `${viewBoxX - (memRatios.value.length - 1)},${viewBoxY} ${memPolylinePoints.value} ${viewBoxX},${viewBoxY}`);

const cpuP = computed(() => ((cpuRatios.value.at(-1) ?? 0) * 100).toFixed(0));
const memP = computed(() => ((memRatios.value.at(-1) ?? 0) * 100).toFixed(0));
</script>

<style lang="scss" module>
.root {
	display: flex;

	> svg {
		display: block;
		padding: 10px;
		width: 50%;

		&:first-child {
			padding-right: 5px;
		}

		&:last-child {
			padding-left: 5px;
		}

		> text {
			font-size: 4.5px;
			fill: currentColor;

			> tspan {
				opacity: 0.5;
			}
		}
	}
}
</style>
