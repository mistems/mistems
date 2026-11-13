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
import { computed, onUnmounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { genId } from '@/utility/id.js';
import { buildDbServerMetricPoints, DB_SERVER_METRIC_MS_PER_UNIT } from '@/utility/db-server-metric-chart.js';
import type { DbServerMetricSample } from '@/utility/db-server-metric-chart.js';

const props = defineProps<{
	history: Misskey.entities.DbServerStats[];
}>();

const viewBoxX = 50;
const viewBoxY = 30;
const cpuGradientId = genId();
const cpuMaskId = genId();
const memGradientId = genId();
const memMaskId = genId();

// サーバーメトリクスのウィジェットと同じ間隔で右端の時刻を進め、グラフを流す
const now = ref(Date.now());
const nowTimer = window.setInterval(() => {
	now.value = Date.now();
}, DB_SERVER_METRIC_MS_PER_UNIT);
onUnmounted(() => {
	window.clearInterval(nowTimer);
});

const cpuSamples = computed<DbServerMetricSample[]>(() => props.history
	.filter(s => s.cpu != null)
	.map(s => ({ time: Date.parse(s.ts), value: s.cpu! })));
const memSamples = computed<DbServerMetricSample[]>(() => props.history
	.filter(s => s.memUsed != null && s.memTotal != null && s.memTotal !== 0)
	.map(s => ({ time: Date.parse(s.ts), value: s.memUsed! / s.memTotal! })));

const toPolyline = (points: [number, number][]) => points.map(([x, y]) => `${x},${y}`).join(' ');
const toPolygon = (points: [number, number][]) => points.length === 0
	? ''
	: `${points[0][0]},${viewBoxY} ${toPolyline(points)} ${points[points.length - 1][0]},${viewBoxY}`;

const cpuPoints = computed(() => buildDbServerMetricPoints(cpuSamples.value, now.value, viewBoxX, viewBoxY));
const memPoints = computed(() => buildDbServerMetricPoints(memSamples.value, now.value, viewBoxX, viewBoxY));
const cpuPolylinePoints = computed(() => toPolyline(cpuPoints.value));
const memPolylinePoints = computed(() => toPolyline(memPoints.value));
const cpuPolygonPoints = computed(() => toPolygon(cpuPoints.value));
const memPolygonPoints = computed(() => toPolygon(memPoints.value));

// 数字は最新の行の値を出す。最新の行で測れなかった値は、1 つ前の行の値で埋めずに「-」にする
const latest = computed(() => props.history.at(-1) ?? null);
const cpuP = computed(() => latest.value?.cpu != null ? (latest.value.cpu * 100).toFixed(0) : '-');
const memP = computed(() => {
	const s = latest.value;
	if (s == null || s.memUsed == null || s.memTotal == null || s.memTotal === 0) return '-';
	return (s.memUsed / s.memTotal * 100).toFixed(0);
});
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
