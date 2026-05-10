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
		<XDisk v-if="widgetProps.view === 0" :stats="latest"/>
		<XCpuMem v-else-if="widgetProps.view === 1" :history="history"/>
		<XConn v-else-if="widgetProps.view === 2" :stats="latest"/>
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
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure, save } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const history = ref<Misskey.entities.DbServerStats[]>([]);
const latest = computed<Misskey.entities.DbServerStats | null>(() => history.value.at(-1) ?? null);

const connection = useStream().useChannel('dbServerStats');

function pushStats(s: Misskey.entities.DbServerStats) {
	history.value.push(s);
	if (history.value.length > HISTORY_LIMIT) history.value.shift();
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
