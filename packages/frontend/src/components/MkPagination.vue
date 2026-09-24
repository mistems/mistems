<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="prefer.s.enablePullToRefresh && pullToRefresh ? MkPullToRefresh : 'div'" :refresher="() => paginator.reload()" @contextmenu.prevent.stop="onContextmenu">
	<div>
		<MkPaginationControl v-if="props.withControl" :paginator="paginator" style="margin-bottom: 10px"/>

		<!-- :css="prefer.s.animation" にしたいけどバグる(おそらくvueのバグ) https://github.com/misskey-dev/misskey/issues/16078 -->
		<Transition
			:enterActiveClass="prefer.s.animation ? $style.transition_fade_enterActive : ''"
			:leaveActiveClass="prefer.s.animation ? $style.transition_fade_leaveActive : ''"
			:enterFromClass="prefer.s.animation ? $style.transition_fade_enterFrom : ''"
			:leaveToClass="prefer.s.animation ? $style.transition_fade_leaveTo : ''"
			:mode="prefer.s.animation ? 'out-in' : undefined"
		>
			<MkLoading v-if="paginator.fetching.value"/>

			<MkError v-else-if="paginator.error.value" @retry="paginator.init()"/>

			<div v-else-if="displayItems.length === 0" key="_empty_">
				<slot name="empty"><MkResult type="empty"/></slot>
			</div>

			<div v-else key="_root_" class="_gaps">
				<div v-if="direction === 'up' || direction === 'both'" v-show="upButtonVisible">
					<MkButton v-if="!upButtonLoading" v-appear="shouldEnableInfiniteScroll ? upButtonClick : null" :class="$style.more" primary rounded @click="upButtonClick">
						{{ i18n.ts.loadMore }}
					</MkButton>
					<MkLoading v-else/>
				</div>
				<slot :items="displayItems" :fetching="paginator.fetching.value || paginator.fetchingOlder.value"></slot>
				<div v-if="direction === 'down' || direction === 'both'" v-show="downButtonVisible">
					<MkButton v-if="!downButtonLoading" v-appear="shouldEnableInfiniteScroll ? downButtonClick : null" :class="$style.more" primary rounded @click="downButtonClick">
						{{ i18n.ts.loadMore }}
					</MkButton>
					<MkLoading v-else/>
				</div>
			</div>
		</Transition>
	</div>
</component>
</template>

<script lang="ts">
export type MkPaginationOptions = {
	autoLoad?: boolean;
	/**
	 * ページネーションを進める方向
	 * - up: 上方向
	 * - down: 下方向 (default)
	 * - both: 双方向
	 *
	 * NOTE: この方向はページネーションの方向であって、アイテムの並び順ではない
	 */
	direction?: 'up' | 'down' | 'both';
	pullToRefresh?: boolean;
	withControl?: boolean;
	forceDisableInfiniteScroll?: boolean;
};
</script>

<script lang="ts" setup generic="T extends IPaginator">
import { isLink } from '@@/js/is-link.js';
import { onMounted, computed, watch, unref, nextTick } from 'vue';
import type { UnwrapRef } from 'vue';
import type { IPaginator } from '@/utility/paginator.js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import MkPaginationControl from '@/components/MkPaginationControl.vue';
import * as os from '@/os.js';

// スクロールコンテナを見つける関数
function getScrollContainer(el: Element | null): Element | null {
	if (!el) return null;

	let current: Element | null = el;
	while (current && current !== window.document.body && current !== window.document.documentElement) {
		const style = window.getComputedStyle(current);
		if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
			return current;
		}
		current = current.parentElement;
	}

	// フォールバック: document.documentElementを返す
	return window.document.documentElement;
}

const props = withDefaults(defineProps<MkPaginationOptions & {
	paginator: T;
	// 外部から表示アイテムを指定可能（タイムマシン機能など用）
	customItems?: UnwrapRef<T['items']>;
}>(), {
	autoLoad: true,
	direction: 'down',
	pullToRefresh: true,
	withControl: false,
	forceDisableInfiniteScroll: false,
});

const shouldEnableInfiniteScroll = computed(() => {
	return prefer.r.enableInfiniteScroll.value && !props.forceDisableInfiniteScroll;
});

// 表示に使うアイテムを決定（customItemsが指定されていればそれを使用）
const displayItems = computed(() => {
	if (props.customItems !== undefined) {
		return props.customItems;
	}
	return getValue(props.paginator.items);
});

function onContextmenu(ev: PointerEvent) {
	if (ev.target && isLink(ev.target as HTMLElement)) return;
	if (window.getSelection()?.toString() !== '') return;

	// TODO: 並び順設定
	os.contextMenu([{
		icon: 'ti ti-refresh',
		text: i18n.ts.reload,
		action: () => {
			props.paginator.reload();
		},
	}], ev);
}

function getValue(v: IPaginator['items']) {
	return unref(v) as UnwrapRef<T['items']>;
}

if (props.autoLoad) {
	onMounted(() => {
		props.paginator.init();
	});
}

if (props.paginator.computedParams) {
	watch(props.paginator.computedParams, () => {
		props.paginator.reload();
	}, { immediate: false, deep: true });
}

// スクロール位置を復元しながらデータを取得する共通関数
async function fetchWithScrollRestore(fetchFn: () => Promise<void>): Promise<void> {
	// スクロール位置復元の準備
	let anchorElement: Element | null = null;
	let anchorOffsetTop = 0;

	// 現在可視範囲にある最初のアンカー要素を記録
	const scrollContainer = getScrollContainer(window.document.activeElement ?? window.document.body);
	if (scrollContainer) {
		const anchors = Array.from(window.document.querySelectorAll('[data-scroll-anchor]'));
		const scrollerRect = scrollContainer.getBoundingClientRect();

		for (const anchor of anchors) {
			const rect = anchor.getBoundingClientRect();
			// 可視範囲内にあるか確認
			if (rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom) {
				anchorElement = anchor;
				anchorOffsetTop = anchor.getBoundingClientRect().top - scrollerRect.top;
				break;
			}
		}
	}

	// データ取得
	await fetchFn();

	// DOM更新を待つ
	await nextTick();

	// スクロール位置を復元
	if (anchorElement && scrollContainer) {
		const anchorId = anchorElement.getAttribute('data-scroll-anchor');

		// 同じIDのアンカー要素を再度探す
		const newAnchor = window.document.querySelector(`[data-scroll-anchor="${anchorId}"]`);
		if (newAnchor) {
			const scrollerRect = scrollContainer.getBoundingClientRect();
			const newAnchorTop = newAnchor.getBoundingClientRect().top;
			const targetScrollTop = scrollContainer.scrollTop + (newAnchorTop - scrollerRect.top - anchorOffsetTop);

			scrollContainer.scrollTop = targetScrollTop;
		}
	}
}

const upButtonVisible = computed(() => {
	return props.paginator.order.value === 'oldest' ? props.paginator.canFetchOlder.value : props.paginator.canFetchNewer.value;
});
const upButtonLoading = computed(() => {
	return props.paginator.order.value === 'oldest' ? props.paginator.fetchingOlder.value : props.paginator.fetchingNewer.value;
});

async function upButtonClick() {
	await fetchWithScrollRestore(() =>
		props.paginator.order.value === 'oldest'
			? props.paginator.fetchOlder()
			: props.paginator.fetchNewer()
	);
}

const downButtonVisible = computed(() => {
	return props.paginator.order.value === 'oldest' ? props.paginator.canFetchNewer.value : props.paginator.canFetchOlder.value;
});
const downButtonLoading = computed(() => {
	return props.paginator.order.value === 'oldest' ? props.paginator.fetchingNewer.value : props.paginator.fetchingOlder.value;
});

async function downButtonClick() {
	await fetchWithScrollRestore(() =>
		props.paginator.order.value === 'oldest'
			? props.paginator.fetchNewer()
			: props.paginator.fetchOlder()
	);
}

defineSlots<{
	empty: () => void;
	default: (props: { items: UnwrapRef<T['items']>, fetching: boolean }) => void;
}>();
</script>

<style lang="scss" module>
.transition_fade_enterActive,
.transition_fade_leaveActive {
	transition: opacity 0.125s ease;
}
.transition_fade_enterFrom,
.transition_fade_leaveTo {
	opacity: 0;
}

.more {
	margin-left: auto;
	margin-right: auto;
}
</style>
