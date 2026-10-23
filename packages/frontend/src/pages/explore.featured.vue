<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 800px;">
	<MkSwitch v-model="enableFavstar" style="margin-bottom: var(--MI-margin);">ふぁぼったー</MkSwitch>

	<MkFolder v-if="enableFavstar" style="margin-bottom: var(--MI-margin);">
		<template #icon><i class="ti ti-palette"></i></template>
		<template #label>ふぁぼったーの色</template>
		<div :class="$style.grid2x2">
			<div :class="$style.gridCell" :style="lightCellStyle">
				<div :class="$style.gridHead">ライトモード</div>
				<div :class="$style.gridRow">
					<span :class="$style.kindLabel">青ふぁぼ</span>
					<div :class="$style.swatchRow">
						<button v-for="o in lightAoOptions" :key="o.value" type="button" :class="[$style.swatch, { [$style.swatchSelected]: favstarLightAo === o.value }]" :style="{ background: o.value }" :title="o.label" @click="favstarLightAo = o.value"></button>
					</div>
				</div>
				<div :class="$style.gridRow">
					<span :class="$style.kindLabel">赤ふぁぼ</span>
					<div :class="$style.swatchRow">
						<button v-for="o in lightAkaOptions" :key="o.value" type="button" :class="[$style.swatch, { [$style.swatchSelected]: favstarLightAka === o.value }]" :style="{ background: o.value }" :title="o.label" @click="favstarLightAka = o.value"></button>
					</div>
				</div>
			</div>
			<div :class="$style.gridCell" :style="darkCellStyle">
				<div :class="$style.gridHead">ダークモード</div>
				<div :class="$style.gridRow">
					<span :class="$style.kindLabel">青ふぁぼ</span>
					<div :class="$style.swatchRow">
						<button v-for="o in darkAoOptions" :key="o.value" type="button" :class="[$style.swatch, { [$style.swatchSelected]: favstarDarkAo === o.value }]" :style="{ background: o.value }" :title="o.label" @click="favstarDarkAo = o.value"></button>
					</div>
				</div>
				<div :class="$style.gridRow">
					<span :class="$style.kindLabel">赤ふぁぼ</span>
					<div :class="$style.swatchRow">
						<button v-for="o in darkAkaOptions" :key="o.value" type="button" :class="[$style.swatch, { [$style.swatchSelected]: favstarDarkAka === o.value }]" :style="{ background: o.value }" :title="o.label" @click="favstarDarkAka = o.value"></button>
					</div>
				</div>
			</div>
		</div>
	</MkFolder>
	<MkTab
		v-model="tab"
		:tabs="[
			{ key: 'notes', label: i18n.ts.notes },
			{ key: 'polls', label: i18n.ts.poll },
		]"
		style="margin-bottom: var(--MI-margin);"
	>
	</MkTab>
	<MkNotesTimeline v-if="tab === 'notes'" :featured="true" :paginator="paginatorForNotes"/>
	<MkNotesTimeline v-else-if="tab === 'polls'" :featured="true" :paginator="paginatorForPolls"/>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import baseLight from '@@/themes/_light.json5';
import baseDark from '@@/themes/_dark.json5';
import defaultLightTheme from '@@/themes/l-light.json5';
import defaultDarkTheme from '@@/themes/d-green-lime.json5';
import type { Theme } from '@@/js/theme.js';
import { compile } from '@@/js/theme.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkTab from '@/components/MkTab.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkFolder from '@/components/MkFolder.vue';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';
import { prefer } from '@/preferences.js';
import { deepClone } from '@/utility/clone.js';

type ColorOption = { value: string; label: string };

function compileWithBase(theme: Theme): Record<string, string> {
	const t = deepClone(theme);
	const base = [baseLight, baseDark].find(x => x.id === t.base);
	if (base) t.props = Object.assign({}, base.props, t.props);
	return compile(t);
}

const compiledLight = computed(() => compileWithBase(prefer.s.lightTheme ?? defaultLightTheme));
const compiledDark = computed(() => compileWithBase(prefer.s.darkTheme ?? defaultDarkTheme));
const lightCellStyle = computed(() => ({ background: compiledLight.value.bg, color: compiledLight.value.fg }));
const darkCellStyle = computed(() => ({ background: compiledDark.value.bg, color: compiledDark.value.fg }));

const enableFavstar = prefer.model('enableFavstar');
const favstarLightAo = prefer.model('favstarLightAo');
const favstarLightAka = prefer.model('favstarLightAka');
const favstarDarkAo = prefer.model('favstarDarkAo');
const favstarDarkAka = prefer.model('favstarDarkAka');

const lightAoOptions: ColorOption[] = [
	{ value: '#44a4c1', label: '既定' },
	{ value: '#2962ff', label: 'Royal' },
	{ value: '#008cff', label: 'Vivid' },
];
const lightAkaOptions: ColorOption[] = [
	{ value: '#f7796c', label: '既定' },
	{ value: '#dd2e44', label: 'Love' },
	{ value: '#db6072', label: 'Cherry' },
];
const darkAoOptions: ColorOption[] = [
	{ value: '#44a4c1', label: '既定' },
	{ value: '#3d6bff', label: 'Royal' },
	{ value: '#70c0e8', label: 'Future' },
];
const darkAkaOptions: ColorOption[] = [
	{ value: '#f7796c', label: '既定' },
	{ value: '#ff5975', label: 'Cherry' },
	{ value: '#ff1f3a', label: 'Blaze' },
];

const paginatorForNotes = markRaw(new Paginator('notes/featured', {
	limit: 10,
}));

const paginatorForPolls = markRaw(new Paginator('notes/polls/recommendation', {
	limit: 10,
	offsetMode: true,
	params: {
		excludeChannels: true,
	},
}));

const tab = ref<'notes' | 'polls'>('notes');
</script>

<style lang="scss" module>
.grid2x2 {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}

@container (max-width: 500px) {
	.grid2x2 {
		grid-template-columns: 1fr;
	}
}

.gridCell {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	border-radius: 8px;
}

.gridHead {
	font-size: 0.85em;
	opacity: 0.7;
}

.gridRow {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 32px;
}

.kindLabel {
	font-size: 0.9em;
	min-width: 5.5em;
}

.swatchRow {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.swatch {
	width: 26px;
	height: 26px;
	border-radius: 50%;
	border: 2px solid transparent;
	padding: 0;
	cursor: pointer;
	box-shadow: 0 0 0 1px rgba(0,0,0,0.1) inset;
	transition: transform 0.1s, border-color 0.1s;
}

.swatch:hover {
	transform: scale(1.1);
}

.swatchSelected {
	border-color: var(--MI_THEME-accent);
	box-shadow: 0 0 0 2px var(--MI_THEME-accent), 0 0 0 1px rgba(0,0,0,0.1) inset;
}
</style>
