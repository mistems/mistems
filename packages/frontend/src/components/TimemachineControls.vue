<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.card" class="_panel">
	<div :class="$style.cardBody">
		<MkSelect v-model="localTimelineSource" :items="timelineSourceItems">
			<template #label>Timeline Source</template>
		</MkSelect>
		<div :class="$style.dateTimeInputs">
			<MkInput v-model="localDateInput" type="date" style="flex: 1;">
				<template #label>Date</template>
			</MkInput>
			<MkInput v-model="localTimeInput" type="time" style="flex: 1;">
				<template #label>Time</template>
			</MkInput>
		</div>
		<div :class="$style.buttonRow">
			<MkButton primary @click="handleGoToDateTime" :disabled="!isValidDateTime" style="width: 100%;">
				<i class="ti ti-clock"></i> <MkTime :time="targetDate" :key="targetDate" />
			</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTime from '@/components/global/MkTime.vue';

const props = defineProps<{
	timelineSource: 'home' | 'local' | 'social' | 'global';
	dateInput: string;
	timeInput: string;
}>();

const emit = defineEmits<{
	'update:timelineSource': [value: 'home' | 'local' | 'social' | 'global'];
	'update:dateInput': [value: string];
	'update:timeInput': [value: string];
	'goToDateTime': [];
}>();

const timelineSourceItems = [
	{ value: 'home', label: 'Home Timeline' },
	{ value: 'local', label: 'Local Timeline' },
	{ value: 'social', label: 'Social Timeline' },
	{ value: 'global', label: 'Global Timeline' },
];

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
}
</style>
