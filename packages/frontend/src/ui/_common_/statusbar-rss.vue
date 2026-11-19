<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span v-if="!fetching" :class="$style.root">
	<template v-if="display === 'marquee'">
		<Transition
			:enterActiveClass="$style.transition_change_enterActive"
			:leaveActiveClass="$style.transition_change_leaveActive"
			:enterFromClass="$style.transition_change_enterFrom"
			:leaveToClass="$style.transition_change_leaveTo"
			mode="default"
		>
			<MkMarqueeText :key="key" :duration="marqueeDuration" :reverse="marqueeReverse">
				<span v-for="item in displayItems" :class="$style.item">
					<a :href="item.link" rel="nofollow noopener" target="_blank" :title="item.title">{{ item.title }}</a><span :class="$style.divider"></span>
				</span>
			</MkMarqueeText>
		</Transition>
	</template>
	<template v-else-if="display === 'oneByOne'">
		<!-- TODO -->
	</template>
</span>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import MkMarqueeText from '@/components/MkMarqueeText.vue';
import { shuffle } from '@/utility/shuffle.js';
import { useRssFeed } from '@/utility/use-rss-feed.js';

const props = defineProps<{
	url: string;
	shuffle?: boolean;
	display?: 'marquee' | 'oneByOne';
	marqueeDuration?: number;
	marqueeReverse?: boolean;
	oneByOneInterval?: number;
	refreshIntervalSec: number;
}>();

// 設定で URL や間隔を変えたら、すぐに取り直す。取れなかったときは、前に取れた項目があればそれを流したままにする
const { items, fetching } = useRssFeed({
	url: () => props.url,
	// ステータスバーの設定は、ほかの種類と共通で秒で保存している
	refreshIntervalMin: () => props.refreshIntervalSec / 60,
});

const displayItems = computed(() => {
	if (!props.shuffle) return items.value;
	const newItems = [...items.value];
	shuffle(newItems);
	return newItems;
});

// 取れた項目が変わったら、流し直す
const key = ref(0);
watch(displayItems, () => {
	key.value++;
});
</script>

<style lang="scss" module>
.transition_change_enterActive,
.transition_change_leaveActive {
	position: absolute;
	top: 0;
  transition: all 1s ease;
}
.transition_change_enterFrom {
	opacity: 0;
	transform: translateY(-100%);
}
.transition_change_leaveTo {
	opacity: 0;
	transform: translateY(100%);
}

.root {
	display: inline-block;
	position: relative;
}

.item {
	display: inline-flex;
	align-items: center;
	vertical-align: bottom;
	margin: 0;
}

.divider {
	display: inline-block;
	width: 0.5px;
	height: var(--height);
	margin: 0 3em;
	background: currentColor;
	opacity: 0.3;
}
</style>
