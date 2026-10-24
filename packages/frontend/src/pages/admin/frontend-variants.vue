<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<MkInfo v-if="!iAmAdmin" warn>{{ i18n.ts._frontendVariants.noPermission }}</MkInfo>
		<MkLoading v-else-if="fetching"/>
		<MkInfo v-else-if="error" warn>{{ i18n.ts._frontendVariants.loadFailed }}</MkInfo>
		<div v-else-if="data != null" class="_gaps_m">
			<MkInfo>{{ i18n.ts._frontendVariants.description }}</MkInfo>

			<div class="_gaps_s">
				<button class="_button" :class="[$style.item, { [$style.active]: data.current == null }]" :disabled="data.current == null" :aria-current="data.current == null ? 'true' : undefined" @click="switchToMain()">
					<i class="ti ti-git-branch" aria-hidden="true"></i>
					<span :class="$style.name">{{ i18n.ts._frontendVariants.mainLine }}</span>
					<span v-if="data.current == null" :class="$style.badge">{{ i18n.ts._frontendVariants.current }}</span>
				</button>
				<button v-for="v in data.variants" :key="v.name" class="_button" :class="[$style.item, { [$style.active]: data.current === v.name }]" :disabled="data.current === v.name" :aria-current="data.current === v.name ? 'true' : undefined" @click="switchTo(v.name)">
					<i class="ti ti-git-branch" aria-hidden="true"></i>
					<span :class="$style.name">{{ v.name }}</span>
					<span :class="$style.sub">{{ v.branch }} / {{ v.mode }}</span>
					<span v-if="data.current === v.name" :class="$style.badge">{{ i18n.ts._frontendVariants.current }}</span>
				</button>
			</div>

			<MkFolder v-if="data.skipped.length > 0">
				<template #label>{{ i18n.ts._frontendVariants.skippedTitle }}</template>
				<div class="_gaps_s">
					<div v-for="(s, i) in data.skipped" :key="`${i}-${s.name}`">
						<div :class="$style.name">{{ s.name }}</div>
						<div :class="$style.sub">{{ s.branch }}</div>
						<div :class="$style.sub">{{ s.reason }}</div>
					</div>
				</div>
			</MkFolder>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import { i18n } from '@/i18n.js';
import { iAmAdmin } from '@/i.js';
import { definePage } from '@/page.js';

type VariantsResponse = {
	current: string | null;
	variants: { name: string; branch: string; mode: 'merge' | 'as-is' }[];
	skipped: { name: string; branch: string; reason: string }[];
};

const data = ref<VariantsResponse | null>(null);
const fetching = ref(iAmAdmin);
const error = ref(false);

async function load() {
	if (!iAmAdmin) return;
	fetching.value = true;
	error.value = false;
	try {
		const res = await window.fetch('/__fe/variants.json', { credentials: 'same-origin' });
		if (!res.ok) throw new Error(String(res.status));
		data.value = await res.json() as VariantsResponse;
	} catch (err) {
		console.error(err);
		error.value = true;
	} finally {
		fetching.value = false;
	}
}

function switchTo(name: string) {
	// 取得した一覧に含まれる名前だけを Cookie に書く
	if (data.value == null || !data.value.variants.some(v => v.name === name)) return;
	// Cookie 名・Max-Age (604800)・属性は packages/backend/src/server/web/frontend-variant.ts の
	// buildVariantCookie / FRONTEND_VARIANT_COOKIE と一致させること
	window.document.cookie = `mk_fe_variant=${name}; Path=/; Max-Age=604800; SameSite=Lax` + (window.location.protocol === 'https:' ? '; Secure' : '');
	window.location.reload();
}

function switchToMain() {
	window.location.href = '/__fe/switch';
}

load();

definePage(() => ({
	title: i18n.ts._frontendVariants.title,
	icon: 'ti ti-git-branch',
}));
</script>

<style lang="scss" module>
.item {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 12px 14px;
	box-sizing: border-box;
	text-align: left;
	background: var(--MI_THEME-panel);
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 8px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.active {
		border-color: var(--MI_THEME-accent);
	}
}

.name {
	font-weight: bold;
}

.sub {
	font-size: 85%;
	opacity: 0.7;
}

.badge {
	margin-left: auto;
	padding: 2px 8px;
	font-size: 80%;
	color: var(--MI_THEME-fgOnAccent);
	background: var(--MI_THEME-accent);
	border-radius: 999px;
}
</style>
