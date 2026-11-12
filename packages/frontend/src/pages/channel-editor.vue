<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<div v-if="channelId == null || channel != null" class="_gaps_m">
			<MkInput v-model="name">
				<template #label>{{ i18n.ts.name }}</template>
			</MkInput>

			<MkTextarea v-model="description" mfmAutocomplete :mfmPreview="true">
				<template #label>{{ i18n.ts.description }}</template>
			</MkTextarea>

			<MkColorInput v-model="color">
				<template #label>{{ i18n.ts.color }}</template>
			</MkColorInput>

			<MkSwitch v-model="isSensitive">
				<template #label>{{ i18n.ts.sensitive }}</template>
			</MkSwitch>

			<MkSwitch v-model="allowRenoteToExternal">
				<template #label>{{ i18n.ts._channel.allowRenoteToExternal }}</template>
			</MkSwitch>

			<MkSelect v-model="federationPolicy" :items="federationPolicyDef" :disabled="!allowRenoteToExternal">
				<template #label>🪐 {{ i18n.ts._channel.federationPolicy }}</template>
				<template #caption>{{ i18n.ts._channel.federationPolicyDescription }}</template>
			</MkSelect>

			<div>
				<MkButton v-if="bannerId == null" @click="setBannerImage"><i class="ti ti-plus"></i> {{ i18n.ts._channel.setBanner }}</MkButton>
				<div v-else-if="bannerUrl">
					<img :src="bannerUrl" style="width: 100%;"/>
					<MkButton @click="removeBannerImage()"><i class="ti ti-trash"></i> {{ i18n.ts._channel.removeBanner }}</MkButton>
				</div>
			</div>

			<MkFolder :defaultOpen="true">
				<template #label>{{ i18n.ts.pinnedNotes }}</template>

				<div class="_gaps">
					<MkButton primary rounded @click="addPinnedNote()"><i class="ti ti-plus"></i></MkButton>

					<MkDraggable
						:modelValue="pinnedNoteIds.map(id => ({ id }))"
						direction="vertical"
						manualDragStart
						@update:modelValue="v => pinnedNoteIds = v.map(x => x.id)"
					>
						<template #default="{ item, dragStart }">
							<div :class="$style.pinnedNote">
								<button class="_button" :class="$style.pinnedNoteHandle" tabindex="-1" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-menu"></i></button>
								{{ item.id }}
								<button class="_button" :class="$style.pinnedNoteRemove" @click="removePinnedNote(item.id)"><i class="ti ti-x"></i></button>
							</div>
						</template>
					</MkDraggable>
				</div>
			</MkFolder>

			<div class="_buttons">
				<MkButton primary @click="save()"><i class="ti ti-device-floppy"></i> {{ channelId ? i18n.ts.save : i18n.ts.create }}</MkButton>
				<MkButton v-if="channelId" danger @click="archive()"><i class="ti ti-trash"></i> {{ i18n.ts.archive }}</MkButton>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkColorInput from '@/components/MkColorInput.vue';
import { selectFile } from '@/utility/drive.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import MkFolder from '@/components/MkFolder.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import { useRouter } from '@/router.js';
import { useMkSelect } from '@/composables/use-mkselect.js';

const router = useRouter();

const props = defineProps<{
	channelId?: string;
}>();

const channel = ref<Misskey.entities.Channel | null>(null);
const name = ref<string>('');
const description = ref<string | null>(null);
const bannerUrl = ref<string | null>(null);
const bannerId = ref<string | null>(null);
const color = ref('#000');
const isSensitive = ref(false);
const allowRenoteToExternal = ref(true);
const {
	model: federationPolicy,
	def: federationPolicyDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._channel._federationPolicy.none, value: 'none' },
		{ label: i18n.ts._channel._federationPolicy.home, value: 'home' },
		{ label: i18n.ts._channel._federationPolicy.public, value: 'public' },
	],
	initialValue: 'none' as 'none' | 'home' | 'public',
});
const pinnedNoteIds = ref<Misskey.entities.Note['id'][]>([]);

watch(allowRenoteToExternal, () => {
	// チャンネル外リノート禁止と連合は両立しない
	if (!allowRenoteToExternal.value) {
		federationPolicy.value = 'none';
	}
});

watch(() => bannerId.value, async () => {
	if (bannerId.value == null) {
		bannerUrl.value = null;
	} else {
		bannerUrl.value = (await misskeyApi('drive/files/show', {
			fileId: bannerId.value,
		})).url;
	}
});

async function fetchChannel() {
	if (props.channelId == null) return;

	const result = await misskeyApi('channels/show', {
		channelId: props.channelId,
	});

	name.value = result.name;
	description.value = result.description;
	bannerId.value = result.bannerId;
	bannerUrl.value = result.bannerUrl;
	isSensitive.value = result.isSensitive;
	pinnedNoteIds.value = result.pinnedNoteIds;
	color.value = result.color;
	allowRenoteToExternal.value = result.allowRenoteToExternal;
	federationPolicy.value = result.federationPolicy ?? 'none';

	channel.value = result;
}

fetchChannel();

async function addPinnedNote() {
	const { canceled, result: value } = await os.inputText({
		title: i18n.ts.noteIdOrUrl,
	});
	if (canceled || value == null) return;
	const fromUrl = value.includes('/') ? value.split('/').pop() : null;
	const note = await os.apiWithDialog('notes/show', {
		noteId: fromUrl ?? value,
	});
	pinnedNoteIds.value.unshift(note.id);
}

function removePinnedNote(id: string) {
	pinnedNoteIds.value = pinnedNoteIds.value.filter(x => x !== id);
}

async function save() {
	// 連合の露出度が変わる場合は確認する。
	// 露出が上がる方向 (none < home < public) は「外に出る」旨、
	// 下がる方向 (連合 → none) は「配信済みは取り消せない」旨を伝える。
	const rank = { none: 0, home: 1, public: 2 } as const;
	const prev = channel.value?.federationPolicy ?? 'none';
	const next = federationPolicy.value;
	if (rank[next] > rank[prev]) {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._channel.federationPolicy,
			text: prev === 'none' ? i18n.ts._channel.federationPolicyEnableConfirm : i18n.ts._channel.federationPolicyEscalateConfirm,
		});
		if (canceled) return;
	} else if (rank[next] < rank[prev]) {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._channel.federationPolicy,
			text: i18n.ts._channel.federationPolicyDisableConfirm,
		});
		if (canceled) return;
	}

	const params = {
		name: name.value,
		description: description.value,
		bannerId: bannerId.value,
		color: color.value,
		isSensitive: isSensitive.value,
		allowRenoteToExternal: allowRenoteToExternal.value,
		federationPolicy: federationPolicy.value,
	} satisfies Misskey.entities.ChannelsCreateRequest;

	if (props.channelId != null) {
		os.apiWithDialog('channels/update', {
			...params,
			channelId: props.channelId,
			pinnedNoteIds: pinnedNoteIds.value,
		}).then(updated => {
			// 保存後に手元の状態を更新し、続けて編集した場合に確認ダイアログの判定が古くならないようにする
			channel.value = updated;
		});
	} else {
		os.apiWithDialog('channels/create', params).then(created => {
			router.push('/channels/:channelId', {
				params: {
					channelId: created.id,
				},
			});
		});
	}
}

async function archive() {
	if (props.channelId == null) return;

	const { canceled } = await os.confirm({
		type: 'warning',
		title: i18n.tsx.channelArchiveConfirmTitle({ name: name.value }),
		text: i18n.ts.channelArchiveConfirmDescription,
	});
	if (canceled) return;

	misskeyApi('channels/update', {
		channelId: props.channelId,
		isArchived: true,
	}).then(() => {
		os.success();
	});
}

function setBannerImage(evt: PointerEvent) {
	selectFile({
		anchorElement: evt.currentTarget ?? evt.target,
		multiple: false,
	}).then(file => {
		bannerId.value = file.id;
	});
}

function removeBannerImage() {
	bannerId.value = null;
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: props.channelId ? i18n.ts._channel.edit : i18n.ts._channel.create,
	icon: 'ti ti-device-tv',
}));
</script>

<style lang="scss" module>
.pinnedNote {
	position: relative;
	display: block;
	line-height: 2.85rem;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
	color: var(--MI_THEME-navFg);
}

.pinnedNoteRemove {
	position: absolute;
	z-index: 10000;
	width: 32px;
	height: 32px;
	color: #ff2a2a;
	right: 8px;
	opacity: 0.8;
}

.pinnedNoteHandle {
	cursor: move;
	width: 32px;
	height: 32px;
	margin: 0 8px;
	opacity: 0.5;
}
</style>
