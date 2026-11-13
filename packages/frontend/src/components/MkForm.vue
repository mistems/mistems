<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="Object.values(form).filter(item => typeof item.hidden !== 'boolean' || item.hidden === true).length > 0" class="_gaps_m">
	<template v-for="v, k in form">
		<template v-if="typeof v.hidden == 'function' ? v.hidden(values) : v.hidden"></template>
		<MkInput v-else-if="v.type === 'number'" v-model="values[k]" type="number" :step="v.step || 1" :min="v.min" :max="v.max" :manualSave="v.manualSave" @savingStateChange="(changed, invalid) => onSavingStateChange(k, changed, invalid)">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
			<template v-if="v.suffix" #suffix>{{ v.suffix }}</template>
			<template v-if="v.description" #caption><span :class="{ [$style.invalidCaption]: isOutOfRange(v, values[k]) }">{{ v.description }}</span></template>
		</MkInput>
		<MkInput v-else-if="v.type === 'string' && !v.multiline" v-model="values[k]" type="text" :mfmAutocomplete="v.treatAsMfm" :manualSave="v.manualSave" @savingStateChange="(changed, invalid) => onSavingStateChange(k, changed, invalid)">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
			<template v-if="v.description" #caption>{{ v.description }}</template>
		</MkInput>
		<MkTextarea v-else-if="v.type === 'string' && v.multiline" v-model="values[k]" :mfmAutocomplete="v.treatAsMfm" :mfmPreview="v.treatAsMfm" :manualSave="v.manualSave" @savingStateChange="(changed, invalid) => onSavingStateChange(k, changed, invalid)">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
			<template v-if="v.description" #caption>{{ v.description }}</template>
		</MkTextarea>
		<MkSwitch v-else-if="v.type === 'boolean'" v-model="values[k]">
			<span v-text="v.label || k"></span>
			<template v-if="v.description" #caption>{{ v.description }}</template>
		</MkSwitch>
		<MkSelect v-else-if="v.type === 'enum'" v-model="values[k]" :items="getMkSelectDef(v)">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
		</MkSelect>
		<MkRadios v-else-if="v.type === 'radio'" v-model="values[k]" :options="getRadioOptionsDef(v)">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
		</MkRadios>
		<MkRange v-else-if="v.type === 'range'" v-model="values[k]" :min="v.min" :max="v.max" :step="v.step" :textConverter="v.textConverter">
			<template #label><span v-text="v.label || k"></span><span v-if="v.required === false"> ({{ i18n.ts.optional }})</span></template>
			<template v-if="v.description" #caption>{{ v.description }}</template>
		</MkRange>
		<MkButton v-else-if="v.type === 'button'" @click="v.action($event, values)">
			<span v-text="v.content || k"></span>
		</MkButton>
		<XFile
			v-else-if="v.type === 'drive-file'"
			:fileId="v.defaultFileId"
			:validate="async f => !v.validate || await v.validate(f)"
			@update="f => values[k] = f"
		/>
	</template>
</div>
<MkResult v-else type="empty" :text="i18n.ts.nothingToConfigure"/>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import XFile from '@/components/MkForm.file.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkRange from '@/components/MkRange.vue';
import MkButton from '@/components/MkButton.vue';
import MkRadios from '@/components/MkRadios.vue';
import { i18n } from '@/i18n.js';
import type { MkSelectItem } from '@/components/MkSelect.vue';
import type { MkRadiosOption } from '@/components/MkRadios.vue';
import type { Form, EnumFormItem, NumberFormItem, RadioFormItem } from '@/utility/form.js';

const props = defineProps<{
	form: Form;
}>();

const emit = defineEmits<{
	(ev: 'canSaveStateChange', canSave: boolean): void;
}>();

// TODO: ジェネリックにしたい
const values = defineModel<Record<string, any>>({ required: true });

// 保存可能状態の管理
const inputSavingStates = ref<Record<string, { changed: boolean; invalid: boolean }>>({});

function onSavingStateChange(key: string, changed: boolean, invalid: boolean) {
	inputSavingStates.value[key] = { changed, invalid };
}

// min・max のある数の項目は、範囲の外の値や数でない値、step に合わない値では保存できない
function isOutOfRange(def: NumberFormItem, value: unknown): boolean {
	if (def.min == null && def.max == null) return false;
	if (typeof value !== 'number' || !Number.isFinite(value)) return true;
	if (Number.isInteger(def.step ?? 1) && !Number.isInteger(value)) return true;
	return (def.min != null && value < def.min) || (def.max != null && value > def.max);
}

function isHidden(key: string): boolean {
	const hidden = props.form[key].hidden;
	return typeof hidden === 'function' ? hidden(values.value) : hidden === true;
}

const canSave = computed(() => {
	for (const key in props.form) {
		const def = props.form[key];
		// 隠れている項目は直せないので、確かめない
		if (def.type === 'number' && !isHidden(key) && isOutOfRange(def, values.value[key])) return false;
	}
	for (const key in inputSavingStates.value) {
		const state = inputSavingStates.value[key];
		if (
			('manualSave' in props.form[key] && props.form[key].manualSave && state.changed) ||
			state.invalid
	 	) {
			return false;
		}
		if ('required' in props.form[key] && props.form[key].required) {
			const val = values.value[key];
			if (val === null || val === undefined || val === '') {
				return false;
			}
		}
	}
	return true;
});

watch(canSave, (newCanSave) => {
	emit('canSaveStateChange', newCanSave);
}, { immediate: true });

function getMkSelectDef(def: EnumFormItem): MkSelectItem[] {
	return def.enum.map((v) => {
		if (typeof v === 'string') {
			return { value: v, label: v };
		} else {
			return { value: v.value, label: v.label };
		}
	});
}

function getRadioOptionsDef(def: RadioFormItem): MkRadiosOption[] {
	return def.options.map<MkRadiosOption>((v) => {
		if (typeof v === 'string') {
			return { value: v, label: v };
		} else {
			return { value: v.value, label: v.label };
		}
	});
}
</script>

<style lang="scss" module>
.invalidCaption {
	color: var(--MI_THEME-error);
}
</style>
