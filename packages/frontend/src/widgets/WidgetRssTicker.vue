<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :naked="widgetProps.transparent" :showHeader="widgetProps.showHeader" class="mkw-rss-ticker">
	<template #icon><i class="ti ti-rss"></i></template>
	<template #header>RSS</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" @click="configure"><i class="ti ti-settings"></i></button></template>

	<div :class="$style.feed">
		<div v-if="fetching" :class="$style.loading">
			<MkEllipsis/>
		</div>
		<div v-else-if="fetchError != null && rawItems.length === 0" :class="$style.loading">
			<i class="ti ti-alert-triangle"></i> {{ getRssFetchErrorText(fetchError) }}
		</div>
		<div v-else>
			<Transition :name="$style.change" mode="default" appear>
				<MkMarqueeText :key="key" :duration="widgetProps.duration" :reverse="widgetProps.reverse">
					<span v-for="item in items" :key="item.link" :class="$style.item">
						<a :href="item.link" rel="nofollow noopener" target="_blank" :title="item.title">{{ item.title }}</a><span :class="$style.divider"></span>
					</span>
				</MkMarqueeText>
			</Transition>
		</div>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { ref, watch, computed } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import MkMarqueeText from '@/components/MkMarqueeText.vue';
import MkContainer from '@/components/MkContainer.vue';
import { shuffle } from '@/utility/shuffle.js';
import { i18n } from '@/i18n.js';
import { getRssFetchErrorText, RSS_DEFAULT_REFRESH_INTERVAL_MIN, RSS_MAX_REFRESH_INTERVAL_MIN, RSS_MIN_REFRESH_INTERVAL_MIN } from '@/utility/fetch-rss.js';
import { useRssFeed } from '@/utility/use-rss-feed.js';

const name = 'rssTicker';

const widgetPropsDef = {
	url: {
		type: 'string',
		label: i18n.ts._widgetOptions._rss.url,
		default: 'http://feeds.afpbb.com/rss/afpbb/afpbbnews',
		manualSave: true,
	},
	shuffle: {
		type: 'boolean',
		label: i18n.ts._widgetOptions._rssTicker.shuffle,
		default: true,
	},
	refreshIntervalMin: {
		type: 'number',
		label: i18n.ts._widgetOptions._rss.refreshIntervalMin,
		description: i18n.tsx._widgetOptions._rss.refreshIntervalMinDescription({ min: RSS_MIN_REFRESH_INTERVAL_MIN, max: RSS_MAX_REFRESH_INTERVAL_MIN }),
		default: RSS_DEFAULT_REFRESH_INTERVAL_MIN,
		min: RSS_MIN_REFRESH_INTERVAL_MIN,
		max: RSS_MAX_REFRESH_INTERVAL_MIN,
		suffix: i18n.ts._time.minute,
	},
	maxEntries: {
		type: 'number',
		label: i18n.ts._widgetOptions._rss.maxEntries,
		default: 15,
	},
	duration: {
		type: 'range',
		label: i18n.ts._widgetOptions._rssTicker.duration,
		default: 70,
		step: 1,
		min: 5,
		max: 200,
	},
	reverse: {
		type: 'boolean',
		label: i18n.ts._widgetOptions._rssTicker.reverse,
		default: false,
	},
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: false,
	},
	transparent: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.transparent,
		default: false,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

// 取れなかったときは、前に取れた項目があればそれを流したままにする
const { items: rawItems, fetching, error: fetchError } = useRssFeed({
	url: () => widgetProps.url,
	refreshIntervalMin: () => widgetProps.refreshIntervalMin,
});
const items = computed(() => {
	const newItems = rawItems.value.slice(0, widgetProps.maxEntries);
	if (widgetProps.shuffle) {
		shuffle(newItems);
	}
	return newItems;
});

// 取れた項目が変わったら、流し直す
const key = ref(0);
watch(rawItems, () => {
	key.value++;
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.change {
	&:global(-enter-active),
	&:global(-leave-active) {
		position: absolute;
		top: 0;
		transition: all 1s ease;
	}
	&:global(-enter-from) {
		opacity: 0;
		transform: translateY(-100%);
	}
	&:global(-leave-to) {
		opacity: 0;
		transform: translateY(100%);
	}
}

.feed {
	--height: 42px;
	padding: 0;
	font-size: 0.9em;
	line-height: var(--height);
	height: var(--height);
	contain: strict;
}

.loading {
	text-align: center;
}

.item {
	display: inline-flex;
	align-items: center;
	vertical-align: bottom;
	color: var(--MI_THEME-fg);
}

.divider {
	display: inline-block;
	width: 0.5px;
	height: 16px;
	margin: 0 1em;
	background: var(--MI_THEME-divider);
}
</style>
