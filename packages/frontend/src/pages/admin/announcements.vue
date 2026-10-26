<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<XGroups v-if="tab === 'groups'" @changed="fetchGroups"/>
		<div v-else class="_gaps">
			<MkInfo>{{ i18n.ts._announcement.shouldNotBeUsedToPresentPermanentInfo }}</MkInfo>
			<MkInfo v-if="announcementsStatus === 'active' && announcements.length > 5" warn>{{ i18n.ts._announcement.tooManyActiveAnnouncementDescription }}</MkInfo>

			<div :class="$style.filters">
				<MkSelect v-model="announcementsStatus" :items="announcementsStatusDef">
					<template #label>{{ i18n.ts.filter }}</template>
				</MkSelect>
				<MkSelect v-if="groups.length > 0" v-model="groupFilter" :items="groupFilterItems">
					<template #label>{{ i18n.ts._announcement.filterByGroup }}</template>
				</MkSelect>
			</div>

			<MkLoading v-if="loading"/>

			<template v-else>
				<XReorder
					v-if="groupFilterId !== undefined && announcementsStatus === 'active' && savedAnnouncements.length > 1"
					:groupId="groupFilterId"
					:announcements="savedAnnouncements"
					@saved="refresh"
				/>
				<MkFolder v-for="announcement in announcements" :key="announcement.id ?? announcement._id" :defaultOpen="announcement.id == null">
					<template #label>{{ announcement.title }}</template>
					<template #icon>
						<i v-if="announcement.icon === 'info'" class="ti ti-info-circle"></i>
						<i v-else-if="announcement.icon === 'warning'" class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i>
						<i v-else-if="announcement.icon === 'error'" class="ti ti-circle-x" style="color: var(--MI_THEME-error);"></i>
						<i v-else-if="announcement.icon === 'success'" class="ti ti-check" style="color: var(--MI_THEME-success);"></i>
					</template>
					<template #caption>
						<span :class="$style.announcementText">{{ announcement.text }}</span>
					</template>
					<template #suffix>
						<span v-if="announcement.autoArchiveAt" :class="$style.autoArchiveAt">
							<i class="ti ti-calendar-time"></i> {{ i18n.ts._announcement.autoArchiveAt }}: <MkTime :key="announcement.autoArchiveAt" :time="announcement.autoArchiveAt" mode="absolute"/>
						</span>
					</template>
					<template #footer>
						<div class="_buttons">
							<MkButton rounded primary @click="save(announcement)"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
							<MkButton v-if="announcement.id != null && announcement.isActive" rounded @click="archive(announcement)"><i class="ti ti-check"></i> {{ i18n.ts._announcement.end }} ({{ i18n.ts.archive }})</MkButton>
							<MkButton v-if="announcement.id != null && !announcement.isActive" rounded @click="unarchive(announcement)"><i class="ti ti-restore"></i> {{ i18n.ts.unarchive }}</MkButton>
							<MkButton v-if="announcement.id != null" rounded danger @click="del(announcement)"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
						</div>
					</template>

					<div class="_gaps">
						<MkInput v-model="announcement.title">
							<template #label>{{ i18n.ts.title }}</template>
						</MkInput>
						<MkSelect v-if="groups.length > 0" v-model="announcement.groupId" :items="groupSelectItems">
							<template #label>{{ i18n.ts._announcement.group }}</template>
						</MkSelect>
						<MkTextarea v-model="announcement.text" mfmAutocomplete :mfmPreview="true">
							<template #label>{{ i18n.ts.text }}</template>
						</MkTextarea>
						<MkInput v-model="announcement.imageUrl" type="url">
							<template #label>{{ i18n.ts.imageUrl }}</template>
						</MkInput>
						<MkInput v-model="announcement.autoArchiveAt" type="datetime-local">
							<template #label>{{ i18n.ts._announcement.autoArchiveAt }}</template>
							<template #caption>{{ i18n.ts._announcement.autoArchiveAtDescription }}</template>
						</MkInput>
						<MkRadios
							v-model="announcement.icon"
							:options="[
								{ value: 'info', icon: 'ti ti-info-circle' },
								{ value: 'warning', icon: 'ti ti-alert-triangle', iconStyle: 'color: var(--MI_THEME-warn);' },
								{ value: 'error', icon: 'ti ti-circle-x', iconStyle: 'color: var(--MI_THEME-error);' },
								{ value: 'success', icon: 'ti ti-check', iconStyle: 'color: var(--MI_THEME-success);' },
							]"
						>
							<template #label>{{ i18n.ts.icon }}</template>
						</MkRadios>
						<MkRadios
							v-model="announcement.display"
							:options="[
								{ value: 'normal', label: i18n.ts.normal },
								{ value: 'banner', label: i18n.ts.banner },
								{ value: 'dialog', label: i18n.ts.dialog },
							]"
						>
							<template #label>{{ i18n.ts.display }}</template>
						</MkRadios>
						<MkInfo v-if="announcement.display === 'dialog'" warn>{{ i18n.ts._announcement.dialogAnnouncementUxWarn }}</MkInfo>
						<MkSwitch v-model="announcement.forExistingUsers" :helpText="i18n.ts._announcement.forExistingUsersDescription">
							{{ i18n.ts._announcement.forExistingUsers }}
						</MkSwitch>
						<MkSwitch v-model="announcement.silence" :helpText="i18n.ts._announcement.silenceDescription">
							{{ i18n.ts._announcement.silence }}
						</MkSwitch>
						<MkSwitch v-model="announcement.needConfirmationToRead" :helpText="i18n.ts._announcement.needConfirmationToReadDescription">
							{{ i18n.ts._announcement.needConfirmationToRead }}
						</MkSwitch>
						<p v-if="announcement.reads">{{ i18n.tsx.nUsersRead({ n: announcement.reads }) }}</p>
					</div>
				</MkFolder>
				<MkLoading v-if="loadingMore"/>
				<MkButton @click="more()">
					<i class="ti ti-reload"></i>{{ i18n.ts.more }}
				</MkButton>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { ApiWithDialogCustomErrors } from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { genId } from '@/utility/id.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { formatDateTimeString } from '@/utility/format-time-string.js';
import XGroups from './announcements.groups.vue';
import XReorder from './announcements.reorder.vue';
import type { MkSelectItem } from '@/components/MkSelect.vue';

const {
	model: announcementsStatus,
	def: announcementsStatusDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts.active, value: 'active' },
		{ label: i18n.ts.archived, value: 'archived' },
	],
	initialValue: 'active',
});

const loading = ref(true);
const loadingMore = ref(false);

const tab = ref<'announcements' | 'groups'>('announcements');

const groups = ref<Misskey.entities.AnnouncementGroup[]>([]);

async function fetchGroups() {
	groups.value = await misskeyApi('admin/announcements/groups/list', {});
}

fetchGroups();

const ALL_GROUPS = '__all__';
const UNGROUPED = '__ungrouped__';

// グループで絞り込む。ALL_GROUPS はすべて、UNGROUPED はグループに入っていないもの
const groupFilter = ref<string>(ALL_GROUPS);

const groupFilterItems = computed<MkSelectItem<string>[]>(() => [
	{ label: i18n.ts.all, value: ALL_GROUPS },
	...groups.value.map(g => ({ label: g.name, value: g.id })),
	{ label: i18n.ts.other, value: UNGROUPED },
]);

const groupSelectItems = computed<MkSelectItem<string | null>[]>(() => [
	{ label: i18n.ts._announcement.noGroup, value: null },
	...groups.value.map(g => ({ label: g.name, value: g.id })),
]);

// API に渡す groupId。undefined はすべて、null はグループに入っていないもの
const groupFilterId = computed<string | null | undefined>(() => {
	if (groupFilter.value === ALL_GROUPS) return undefined;
	if (groupFilter.value === UNGROUPED) return null;
	return groupFilter.value;
});

function listParams() {
	return {
		status: announcementsStatus.value,
		...(groupFilterId.value !== undefined ? { groupId: groupFilterId.value } : {}),
	};
}

const createAnnouncementErrors: ApiWithDialogCustomErrors = {
	'2a892bd5-487d-46a2-a5fe-3d85ad51defe': {
		title: i18n.ts._announcement.autoArchiveAt,
		text: i18n.ts._announcement.autoArchiveAtMustBeInFuture,
	},
};

type EditableAnnouncement = Omit<Misskey.entities.AdminAnnouncementsListResponse[number], 'id' | 'createdAt' | 'updatedAt' | 'reads' | 'isActive' | 'autoArchiveAt'> & {
	id: string | null;
	_id?: string;
	isActive?: Misskey.entities.AdminAnnouncementsListResponse[number]['isActive'];
	reads?: Misskey.entities.AdminAnnouncementsListResponse[number]['reads'];
	autoArchiveAt: string;
	originalAutoArchiveAt: Misskey.entities.AdminAnnouncementsListResponse[number]['autoArchiveAt'];
};

const announcements = ref<EditableAnnouncement[]>([]);

function toEditableAnnouncement(announcement: Misskey.entities.AdminAnnouncementsListResponse[number]): EditableAnnouncement {
	return {
		...announcement,
		autoArchiveAt: announcement.autoArchiveAt ? formatDateTimeString(new Date(announcement.autoArchiveAt), 'yyyy-MM-ddTHH:mm') : '',
		originalAutoArchiveAt: announcement.autoArchiveAt,
	};
}

function toAutoArchiveAt(value: string, originalValue: Misskey.entities.AdminAnnouncementsListResponse[number]['autoArchiveAt']): number | null {
	if (originalValue != null && value === formatDateTimeString(new Date(originalValue), 'yyyy-MM-ddTHH:mm')) {
		return new Date(originalValue).getTime();
	}

	return value === '' ? null : new Date(value).getTime();
}

const savedAnnouncements = computed(() => announcements.value.filter((a): a is EditableAnnouncement & { id: string } => a.id != null));

watch([announcementsStatus, groupFilter], () => {
	refresh();
}, { immediate: true });

function add() {
	announcements.value.unshift({
		_id: genId(),
		id: null,
		title: 'New announcement',
		text: '',
		imageUrl: null,
		icon: 'info',
		display: 'normal',
		forExistingUsers: false,
		silence: false,
		needConfirmationToRead: false,
		autoArchiveAt: '',
		originalAutoArchiveAt: null,
		userId: null,
		groupId: groupFilterId.value ?? null,
		displayOrder: 0,
	});
}

async function del(announcement: (typeof announcements)['value'][number]) {
	if (announcement.id == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.deleteAreYouSure({ x: announcement.title }),
	});
	if (canceled) return;
	announcements.value = announcements.value.filter(x => x !== announcement);
	misskeyApi('admin/announcements/delete', {
		id: announcement.id,
	});
}

async function archive(announcement: (typeof announcements)['value'][number]) {
	if (announcement.id == null) return;
	const { _id, id, autoArchiveAt, originalAutoArchiveAt, displayOrder, ...data } = announcement; // APIに不要な項目を消す
	await os.apiWithDialog('admin/announcements/update', {
		...data,
		id,
		isActive: false,
		autoArchiveAt: toAutoArchiveAt(autoArchiveAt, originalAutoArchiveAt),
	});
	refresh();
}

async function unarchive(announcement: (typeof announcements)['value'][number]) {
	if (announcement.id == null) return;
	const { _id, id, autoArchiveAt, originalAutoArchiveAt, displayOrder, ...data } = announcement; // APIに不要な項目を消す
	const autoArchiveAtMs = toAutoArchiveAt(autoArchiveAt, originalAutoArchiveAt);
	await os.apiWithDialog('admin/announcements/update', {
		...data,
		id,
		isActive: true,
		autoArchiveAt: autoArchiveAtMs != null && autoArchiveAtMs <= Date.now() ? null : autoArchiveAtMs,
	});
	refresh();
}

async function save(announcement: (typeof announcements)['value'][number]) {
	const { _id, id, isActive, reads, autoArchiveAt, originalAutoArchiveAt, displayOrder, ...data } = announcement; // APIに不要な項目を消す
	const autoArchiveAtMs = toAutoArchiveAt(autoArchiveAt, originalAutoArchiveAt);
	if (id == null) {
		if (autoArchiveAtMs != null && (Number.isNaN(autoArchiveAtMs) || autoArchiveAtMs <= Date.now())) {
			await os.alert({
				type: 'error',
				title: i18n.ts._announcement.autoArchiveAt,
				text: i18n.ts._announcement.autoArchiveAtMustBeInFuture,
			});
			return;
		}

		await os.apiWithDialog('admin/announcements/create', {
			...data,
			autoArchiveAt: autoArchiveAtMs,
		}, undefined, createAnnouncementErrors);
		refresh();
	} else {
		await os.apiWithDialog('admin/announcements/update', {
			...data,
			id,
			isActive,
			autoArchiveAt: autoArchiveAtMs,
		});
	}
}

function more() {
	loadingMore.value = true;
	misskeyApi('admin/announcements/list', {
		...listParams(),
		// グループで絞り込んでいるときは表示順で並ぶので、offset でページを送る
		...(groupFilterId.value !== undefined ? {
			offset: savedAnnouncements.value.length,
		} : {
			untilId: announcements.value.reduce((acc, announcement) => announcement.id != null ? announcement : acc).id!,
		}),
	}).then(announcementResponse => {
		announcements.value = announcements.value.concat(announcementResponse.map(toEditableAnnouncement));
		loadingMore.value = false;
	});
}

function refresh() {
	loading.value = true;
	misskeyApi('admin/announcements/list', listParams()).then(announcementResponse => {
		announcements.value = announcementResponse.map(toEditableAnnouncement);
		loading.value = false;
	});
}

const headerActions = computed(() => tab.value === 'groups' ? [] : [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.add,
	handler: add,
	disabled: announcementsStatus.value === 'archived',
}]);

const headerTabs = computed(() => [{
	key: 'announcements',
	title: i18n.ts.announcements,
	icon: 'ti ti-speakerphone',
}, {
	key: 'groups',
	title: i18n.ts._announcement.groups,
	icon: 'ti ti-folders',
}]);

definePage(() => ({
	title: i18n.ts.announcements,
	icon: 'ti ti-speakerphone',
}));
</script>

<style lang="scss" module>
.filters {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 12px;
}

.announcementText {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.autoArchiveAt {
	white-space: nowrap;
}
</style>
