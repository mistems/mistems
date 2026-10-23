<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkPagination
	:paginator="paginator"
	:direction="direction"
	:autoLoad="autoLoad"
	:pullToRefresh="pullToRefresh"
	:withControl="withControl"
	:forceDisableInfiniteScroll="forceDisableInfiniteScroll"
	:customItems="customItems"
>
	<template #empty><MkResult type="empty" :text="i18n.ts.noNotes"/></template>

	<template #default="{ items: notes }">
		<div :class="[$style.root, { [$style.noGap]: noGap, '_gaps': !noGap }]">
			<template v-for="(note, i) in notes as unknown as FusionNote[]" :key="generateUniqueKey(note)">
				<div
					v-if="i > 0 && isSeparatorNeeded(notes[i - 1].createdAt, note.createdAt)"
					:class="{ '_gaps': !noGap }"
				>
					<div :class="[$style.date, { [$style.noGap]: noGap }]">
						<span><i class="ti ti-chevron-up"></i> {{ getSeparatorInfo(notes[i - 1].createdAt, note.createdAt)?.prevText }}</span>
						<span style="height: 1em; width: 1px; background: var(--MI_THEME-divider);"></span>
						<span>{{ getSeparatorInfo(notes[i - 1].createdAt, note.createdAt)?.nextText }} <i class="ti ti-chevron-down"></i></span>
					</div>
					<MkNote :class="[$style.note, { [$style.realtimeNote]: isRealtimeItem(note), [$style.realtimeNoteAnimating]: shouldAnimate(note) }]" :note="note" :withHardMute="true" :disableSkipRender="true" :data-scroll-anchor="note.id"/>
				</div>
				<MkNote v-else :class="[$style.note, { [$style.realtimeNote]: isRealtimeItem(note), [$style.realtimeNoteAnimating]: shouldAnimate(note) }]" :note="note" :withHardMute="true" :disableSkipRender="true" :data-scroll-anchor="note.id"/>
			</template>
		</div>
	</template>
</MkPagination>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { MkPaginationOptions } from '@/components/MkPagination.vue';
import { isFusionNote } from '@/utility/timeshiftPaginator.js';
import type { TimeshiftPaginator, FusionNote } from '@/utility/timeshiftPaginator.js';
import MkNote from '@/components/MkNote.vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { useGlobalEvent } from '@/events.js';
import { isSeparatorNeeded, getSeparatorInfo } from '@/utility/timeline-date-separate.js';

const props = withDefaults(defineProps<MkPaginationOptions & {
	paginator: TimeshiftPaginator;
	noGap?: boolean;
}>(), {
	autoLoad: true,
	direction: 'down',
	pullToRefresh: true,
	withControl: false,
	forceDisableInfiniteScroll: false,
});

// タイムフュージョンモード時はfusionItems、タイムシフトモード時はtimeshiftItems、通常モード時はitemsを使用
const customItems: ComputedRef<FusionNote[]> = computed(() => {
	if (props.paginator.isTimefusionMode.value) {
		// fusionItemsはtimeshiftItemsとrealtimeItemsを統合したもの
		return props.paginator.fusionItems.value;
	}
	if (props.paginator.isTimeshiftMode.value) {
		return props.paginator.timeshiftItems.value;
	}
	return props.paginator.items.value || [];
});

// リアルタイムアイテムかどうかを判定する関数（型安全）
function isRealtimeItem(note: Misskey.entities.Note | FusionNote): note is FusionNote & { _isRealtime: true } {
	return isFusionNote(note) && note._isRealtime === true;
}

// アニメーション実行済みのノートIDを記録（メモリリーク対策のため上限を設定）
const MAX_ANIMATED_IDS = 1000;
const animatedNoteIds = new Set<string>();

// アニメーションを実行すべきかどうかを判定する関数
function shouldAnimate(note: FusionNote): boolean {
	if (!isRealtimeItem(note)) return false;
	if (animatedNoteIds.has(note.id)) return false;

	// サイズ制限: 上限に達したらクリア
	if (animatedNoteIds.size >= MAX_ANIMATED_IDS) {
		animatedNoteIds.clear();
	}

	// 初回表示時のみアニメーション実行
	animatedNoteIds.add(note.id);
	return true;
}

// ユニークなkeyを生成する関数
function generateUniqueKey(note: FusionNote): string {
	const origin = note._isRealtime ? 'rt' : 'ts'; // rt=realtime, ts=timeshift
	// 修正: Math.random()を削除し、安定したキーを生成
	// 同じノートには常に同じキーを返すことで、Vueが既存のDOM要素を再利用できる
	return `${note.id}-${origin}`;
}

useGlobalEvent('noteDeleted', (noteId) => {
	props.paginator.removeItem(noteId);
});

function reload() {
	return props.paginator.reload();
}

defineExpose({
	reload,
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;

	&.noGap {
		background: var(--MI_THEME-panel);

		.note {
			border-bottom: solid 0.5px var(--MI_THEME-divider);
		}
	}

	&:not(.noGap) {
		background: var(--MI_THEME-bg);

		.note {
			background: var(--MI_THEME-panel);
			border-radius: var(--MI-radius);
		}
	}
}

.date {
	display: flex;
	font-size: 85%;
	align-items: center;
	justify-content: center;
	gap: 1em;
	opacity: 0.75;
	padding: 8px 8px;
	margin: 0 auto;

	&.noGap {
		border-bottom: solid 0.5px var(--MI_THEME-divider);
	}
}

.realtimeNote {
	position: relative;

	&::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		border: 2px dashed var(--MI_THEME-accent);
		border-radius: var(--MI-radius);
		pointer-events: none;
	}
}

.realtimeNoteAnimating {
	animation: realtimePulse 2s ease-in-out, realtimeSlideIn 0.5s ease-out;
}

@keyframes realtimePulse {
	0% {
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--MI_THEME-accent) 40%, transparent);
	}
	50% {
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--MI_THEME-accent) 0%, transparent);
	}
	100% {
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--MI_THEME-accent) 0%, transparent);
	}
}

@keyframes realtimeSlideIn {
	0% {
		transform: translateX(100%);
		opacity: 0;
	}
	100% {
		transform: translateX(0);
		opacity: 1;
	}
}
</style>
