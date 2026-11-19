<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="controlsEl" :class="$style.card" class="_panel">
	<div :class="$style.cardBody">
		<MkSelect ref="timelineSourceSelect" v-model="localTimelineSource" :items="timelineSourceItems">
			<template #label>{{ i18n.ts._timemachine.timelineSource }}</template>
		</MkSelect>
		<div ref="dateTimeInputsEl" :class="$style.dateTimeInputs">
			<MkInput v-model="localDateInput" type="date" style="flex: 1;">
				<template #label>{{ i18n.ts.date }}</template>
			</MkInput>
			<MkInput v-model="localTimeInput" type="time" style="flex: 1;">
				<template #label>{{ i18n.ts.time }}</template>
			</MkInput>
		</div>
		<div ref="goButtonEl" :class="$style.buttonRow">
			<MkButton primary :disabled="!isValidDateTime" style="width: 100%;" @click="handleGoToDateTime">
				<i class="ti ti-clock"></i>
				<I18n :src="i18n.ts._timemachine.goTo" tag="span">
					<template #date><MkTime :key="targetDate" :time="targetDate"/></template>
				</I18n>
			</MkButton>
		</div>
		<div v-if="showModeButtons" ref="modeButtonsEl" :class="$style.buttonRow">
			<MkButton ref="timeshiftButton" :disabled="!isValidDateTime" style="flex: 1;" @click="handleStart('startTimeshift')">
				<i class="ti ti-player-play"></i> {{ i18n.ts._timemachine.startTimeshift }}
			</MkButton>
			<MkButton :disabled="!isValidDateTime" style="flex: 1;" @click="handleStart('startTimefusion')">
				<i class="ti ti-bolt"></i> {{ i18n.ts._timemachine.startTimefusion }}
			</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTime from '@/components/global/MkTime.vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	timelineSource: 'home' | 'local' | 'social' | 'global';
	dateInput: string;
	timeInput: string;
	// タイムシフト中は、プレイヤー側で操作するので開始ボタンを出さない
	showModeButtons: boolean;
}>();

const emit = defineEmits<{
	'update:timelineSource': [value: 'home' | 'local' | 'social' | 'global'];
	'update:dateInput': [value: string];
	'update:timeInput': [value: string];
	'goToDateTime': [];
	'startTimeshift': [];
	'startTimefusion': [];
}>();

const timelineSourceItems = [
	{ value: 'home', label: i18n.ts._timelines.home },
	{ value: 'local', label: i18n.ts._timelines.local },
	{ value: 'social', label: i18n.ts._timelines.social },
	{ value: 'global', label: i18n.ts._timelines.global },
];

// 使い方ツアーで指し示すための要素
const controlsEl = useTemplateRef<HTMLElement>('controlsEl');
const goButtonEl = useTemplateRef<HTMLElement>('goButtonEl');
const modeButtonsEl = useTemplateRef<HTMLElement>('modeButtonsEl');
const timeshiftButton = useTemplateRef<InstanceType<typeof MkButton>>('timeshiftButton');
const timeshiftButtonEl = computed(() => timeshiftButton.value?.$el as HTMLElement | undefined);

const timelineSourceSelect = useTemplateRef<ComponentPublicInstance>('timelineSourceSelect');
const dateTimeInputsEl = useTemplateRef<HTMLElement>('dateTimeInputsEl');
// タイムラインの種類と日時の入力欄 (ツアーで、日時の指定のところだけを指すのに使う)
const sourceAndDateEls = computed(() => [timelineSourceSelect.value?.$el as HTMLElement | undefined, dateTimeInputsEl.value].filter((el): el is HTMLElement => el != null));

defineExpose({ controlsEl, goButtonEl, modeButtonsEl, timeshiftButtonEl, sourceAndDateEls });

const localTimelineSource = computed({
	get: () => props.timelineSource,
	set: (value) => emit('update:timelineSource', value),
});

const localDateInput = computed({
	get: () => props.dateInput,
	set: (value) => emit('update:dateInput', value),
});

const localTimeInput = computed({
	get: () => props.timeInput,
	set: (value) => emit('update:timeInput', value),
});

const targetDate = computed(() => {
	const datetime = new Date(`${props.dateInput}T${props.timeInput}`);
	if (isNaN(datetime.getTime())) return Infinity;
	return datetime.getTime();
});

const isValidDateTime = computed(() => {
	if (typeof targetDate.value !== 'number') return false;
	return props.dateInput !== '' && props.timeInput !== '' && targetDate.value < Date.now();
});

function handleGoToDateTime() {
	if (!isValidDateTime.value) return;
	emit('goToDateTime');
}

function handleStart(event: 'startTimeshift' | 'startTimefusion') {
	if (!isValidDateTime.value) return;
	if (event === 'startTimeshift') {
		emit('startTimeshift');
	} else {
		emit('startTimefusion');
	}
}
</script>

<style lang="scss" module>
.card {
	padding: 16px;
	margin-bottom: 12px;
}

.cardBody {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.dateTimeInputs {
	display: flex;
	gap: 8px;
}

.buttonRow {
	display: flex;
	gap: 8px;
}
</style>
