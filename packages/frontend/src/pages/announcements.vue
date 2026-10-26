<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkTab v-if="hasGroups" v-model="status" :tabs="statusTabs"/>
			<MkInfo v-if="$i && $i.hasUnreadAnnouncement && status === 'current'" warn>{{ i18n.ts.youHaveUnreadAnnouncements }}</MkInfo>
			<MkInfo v-if="currentGroupKey !== undefined && isAnnouncementGroupMuted(currentGroupKey)">{{ i18n.ts._announcement.mutedTabInfo }}</MkInfo>
			<MkPagination v-slot="{items}" :paginator="paginator" class="_gaps">
				<section v-for="announcement in items" :key="announcement.id" class="_panel" :class="$style.announcement">
					<div v-if="announcement.forYou" :class="$style.forYou"><i class="ti ti-pin"></i> {{ i18n.ts.forYou }}</div>
					<div :class="$style.header">
						<span v-if="$i && !announcement.silence && !isAnnouncementMutedForMe(announcement) && !announcement.isRead" style="margin-right: 0.5em;">🆕</span>
						<span style="margin-right: 0.5em;">
							<i v-if="announcement.icon === 'info'" class="ti ti-info-circle"></i>
							<i v-else-if="announcement.icon === 'warning'" class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i>
							<i v-else-if="announcement.icon === 'error'" class="ti ti-circle-x" style="color: var(--MI_THEME-error);"></i>
							<i v-else-if="announcement.icon === 'success'" class="ti ti-check" style="color: var(--MI_THEME-success);"></i>
						</span>
						<MkA :to="`/announcements/${announcement.id}`"><span>{{ announcement.title }}</span></MkA>
					</div>
					<div :class="$style.content">
						<Mfm :text="announcement.text" class="_selectable"/>
						<img v-if="announcement.imageUrl" :src="announcement.imageUrl"/>
						<MkA :to="`/announcements/${announcement.id}`">
							<div style="margin-top: 8px; opacity: 0.7; font-size: 85%;">
								{{ i18n.ts.createdAt }}: <MkTime :time="announcement.createdAt" mode="detail"/>
							</div>
							<div v-if="announcement.updatedAt" style="opacity: 0.7; font-size: 85%;">
								{{ i18n.ts.updatedAt }}: <MkTime :time="announcement.updatedAt" mode="detail"/>
							</div>
						</MkA>
					</div>
					<div v-if="status !== 'past' && $i != null && !announcement.silence && !isAnnouncementMutedForMe(announcement) && !announcement.isRead" :class="$style.footer">
						<MkButton primary @click="read(announcement)"><i class="ti ti-check"></i> {{ i18n.ts.gotIt }}</MkButton>
					</div>
				</section>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, markRaw, onMounted, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkPagination from '@/components/MkPagination.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkTab from '@/components/MkTab.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import { updateCurrentAccount } from '@/accounts.js';
import { Paginator } from '@/utility/paginator.js';
import { announcementGroupIconClass, isAnnouncementGroupMuted, isAnnouncementMutedForMe, setAnnouncementGroupMuted } from '@/utility/announcement-group.js';

const ALL_TAB = 'all';
const UNGROUPED_TAB = 'ungrouped';

const groups = ref<Misskey.entities.AnnouncementGroup[]>([]);
const hasUngrouped = ref(false);
const hasGroups = computed(() => groups.value.length > 0);

// グループが無いサーバーでは、今までどおりヘッダーのタブで「現在」と「過去」を切り替える
const tab = ref<string>('current');
const status = ref<'current' | 'past'>('current');

watch(tab, (to) => {
	if (!hasGroups.value && (to === 'current' || to === 'past')) status.value = to;
});

// undefined はすべて、null はグループに入っていないもの
const currentGroupKey = computed<string | null | undefined>(() => {
	if (!hasGroups.value || tab.value === ALL_TAB) return undefined;
	if (tab.value === UNGROUPED_TAB) return null;
	return tab.value;
});

const paginator = markRaw(new Paginator('announcements', {
	limit: 10,
	offsetMode: true,
	computedParams: computed(() => ({
		isActive: status.value === 'current',
		...(currentGroupKey.value !== undefined ? { groupId: currentGroupKey.value } : {}),
	})),
}));

onMounted(async () => {
	const fetchedGroups = await misskeyApi('announcements/groups', {});
	if (fetchedGroups.length === 0) return;

	const [ungroupedActive, ungroupedPast] = await Promise.all([
		misskeyApi('announcements', { groupId: null, isActive: true, limit: 1 }),
		misskeyApi('announcements', { groupId: null, isActive: false, limit: 1 }),
	]);
	hasUngrouped.value = ungroupedActive.length > 0 || ungroupedPast.length > 0;
	groups.value = fetchedGroups;
	tab.value = ALL_TAB;
});

const statusTabs: { key: 'current' | 'past'; label: string; icon: string }[] = [{
	key: 'current',
	label: i18n.ts.currentAnnouncements,
	icon: 'ti ti-flare',
}, {
	key: 'past',
	label: i18n.ts.pastAnnouncements,
	icon: 'ti ti-point',
}];

async function read(target: Misskey.entities.Announcement) {
	if ($i == null) return;

	if (target.needConfirmationToRead) {
		const confirm = await os.confirm({
			type: 'question',
			title: i18n.ts._announcement.readConfirmTitle,
			text: i18n.tsx._announcement.readConfirmText({ title: target.title }),
		});
		if (confirm.canceled) return;
	}

	paginator.updateItem(target.id, a => ({
		...a,
		isRead: true,
	}));
	misskeyApi('i/read-announcement', { announcementId: target.id });
	updateCurrentAccount({
		unreadAnnouncements: $i.unreadAnnouncements.filter(a => a.id !== target.id),
	});
}

const headerActions = computed<PageHeaderItem[]>(() => {
	const groupKey = currentGroupKey.value;
	if ($i == null || groupKey === undefined) return [];
	const muted = isAnnouncementGroupMuted(groupKey);
	return [{
		icon: muted ? 'ti ti-bell-off' : 'ti ti-bell',
		text: muted ? i18n.ts._announcement.unmuteGroup : i18n.ts._announcement.muteGroup,
		highlighted: muted,
		handler: () => {
			os.promiseDialog(setAnnouncementGroupMuted(groupKey, !muted));
		},
	}];
});

const headerTabs = computed(() => {
	if (!hasGroups.value) {
		return [{
			key: 'current',
			title: i18n.ts.currentAnnouncements,
			icon: 'ti ti-flare',
		}, {
			key: 'past',
			title: i18n.ts.pastAnnouncements,
			icon: 'ti ti-point',
		}];
	}

	// 非通知のタブは、アイコンをベルの斜線にして分かるようにする
	return [{
		key: ALL_TAB,
		title: i18n.ts.all,
		icon: 'ti ti-speakerphone',
	}, ...groups.value.map(group => ({
		key: group.id,
		title: group.name,
		icon: isAnnouncementGroupMuted(group.id) ? 'ti ti-bell-off' : announcementGroupIconClass(group.icon),
	})), ...(hasUngrouped.value ? [{
		key: UNGROUPED_TAB,
		title: i18n.ts.other,
		icon: isAnnouncementGroupMuted(null) ? 'ti ti-bell-off' : 'ti ti-dots',
	}] : [])];
});

definePage(() => ({
	title: i18n.ts.announcements,
	icon: 'ti ti-speakerphone',
}));
</script>

<style lang="scss" module>
.announcement {
	padding: 16px;
}

.forYou {
	display: flex;
	align-items: center;
	line-height: 24px;
	font-size: 90%;
	white-space: pre;
	color: #d28a3f;
}

.header {
	margin-bottom: 16px;
	font-weight: bold;
}

.content {
	> img {
		display: block;
		max-height: 300px;
		max-width: 100%;
	}
}

.footer {
	margin-top: 16px;
}
</style>
