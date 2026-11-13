<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" :naked="widgetProps.transparent">
	<template #icon><i class="ti ti-database"></i></template>
	<template #header>{{ i18n.ts._widgets.dbServerMetric }}</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" @click="toggleView()"><i class="ti ti-selector"></i></button></template>

	<div data-cy-mkw-dbServerMetric class="mkw-dbServerMetric">
		<div v-if="latest == null" :class="$style.empty">{{ i18n.ts.dbServerStatsNoData }}</div>
		<XDisk v-else-if="widgetProps.view === 0" :stats="latest"/>
		<XCpuMem v-else-if="widgetProps.view === 1" :history="history"/>
		<XConn v-else-if="widgetProps.view === 2" :stats="latest"/>
		<div v-if="hosts.length > 1" :class="$style.hosts">
			<button
				v-for="host in hosts"
				:key="host"
				class="_button"
				:class="[$style.host, { [$style.hostActive]: host === selectedHost }]"
				:aria-pressed="host === selectedHost"
				@click="selectHost(host)"
			>
				{{ host }}
			</button>
		</div>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { useWidgetPropsManager } from '../widget.js';
import type { WidgetComponentProps, WidgetComponentEmits, WidgetComponentExpose } from '../widget.js';
import XDisk from './disk.vue';
import XCpuMem from './cpu-mem.vue';
import XConn from './conn.vue';
import MkContainer from '@/components/MkContainer.vue';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { genId } from '@/utility/id.js';

const name = 'dbServerMetric';
const VIEW_COUNT = 3;
const HISTORY_LIMIT = 50;

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
	transparent: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.transparent,
		default: false,
	},
	view: {
		type: 'number',
		default: 0,
		hidden: true,
	},
	/** DB サーバーが複数台あるときに表示するホスト。空なら名前の順で最初のホスト */
	hostId: {
		type: 'string',
		default: '',
		hidden: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure, save } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

// DB サーバーが複数台あると、ホストごとに行が届く。ホストごとに分けて持つ
const historyByHost = ref<Record<string, Misskey.entities.DbServerStats[]>>({});
const hosts = computed(() => Object.keys(historyByHost.value).sort());
const selectedHost = computed<string | null>(() => hosts.value.includes(widgetProps.hostId) ? widgetProps.hostId : (hosts.value[0] ?? null));
const history = computed<Misskey.entities.DbServerStats[]>(() => selectedHost.value != null ? historyByHost.value[selectedHost.value] ?? [] : []);
const latest = computed<Misskey.entities.DbServerStats | null>(() => history.value.at(-1) ?? null);

const connection = useStream().useChannel('dbServerStats');

function pushStats(s: Misskey.entities.DbServerStats) {
	// requestLog の応答と stats の配信が前後しても、同じ行や古い行を重ねない
	// ??= の戻り値は代入した素の配列で、push しても描き直されないので、入れてから読み直す
	if (!(s.hostId in historyByHost.value)) historyByHost.value[s.hostId] = [];
	const hostHistory = historyByHost.value[s.hostId];
	const last = hostHistory.at(-1);
	if (last != null && Date.parse(s.ts) <= Date.parse(last.ts)) return;
	hostHistory.push(s);
	if (hostHistory.length > HISTORY_LIMIT) hostHistory.shift();
}

function selectHost(host: string) {
	widgetProps.hostId = host;
	save();
}

connection.on('stats', pushStats);
connection.on('statsLog', (log) => {
	for (const s of [...log].reverse()) pushStats(s);
});
connection.send('requestLog', { id: genId(), length: HISTORY_LIMIT });

onUnmounted(() => {
	connection.dispose();
});

const toggleView = () => {
	widgetProps.view = (widgetProps.view + 1) % VIEW_COUNT;
	save();
};

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.empty {
	padding: 16px;
	font-size: 0.85em;
	opacity: 0.7;
}

.hosts {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	padding: 0 10px 10px;
}

.host {
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 0.8em;
	opacity: 0.6;
}

.hostActive {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	opacity: 1;
}
</style>
