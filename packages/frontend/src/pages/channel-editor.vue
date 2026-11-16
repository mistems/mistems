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

			<MkSwitch v-model="allowRenoteToExternal" :disabled="federationPolicy === 'public'">
				<template #label>{{ i18n.ts._channel.allowRenoteToExternal }}</template>
				<template v-if="federationPolicy === 'public'" #caption>{{ i18n.ts._channel.allowRenoteToExternalLockedByFederation }}</template>
			</MkSwitch>

			<MkSelect v-model="federationPolicy" :items="federationPolicyDef">
				<template #label><i class="ti ti-whirl"></i> {{ i18n.ts._channel.federationPolicy }}</template>
				<template #caption>{{ i18n.ts._channel.federationPolicyDescription }}</template>
			</MkSelect>

			<MkInput v-if="federationPolicy === 'public'" v-model="federationHashtag" :placeholder="channel?.federationHashtag == null ? i18n.ts._channel.federationHashtagAutoAssigned : undefined" :disabled="channelId != null && channel?.federationHashtag == null">
				<template #label><i class="ti ti-hash"></i> {{ i18n.ts._channel.federationHashtag }}</template>
				<template #prefix>#</template>
				<template #caption>{{ i18n.ts._channel.federationHashtagDescription }}</template>
			</MkInput>

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
	// 新しく作るときの初期値 (ほかのサーバーの連合チャンネルのハッシュタグから作るとき)
	initialName?: string;
	initialFederationHashtag?: string;
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
		{ label: i18n.ts._channel._federationPolicy.public, value: 'public' },
	],
	initialValue: 'none' as 'none' | 'public',
});
const pinnedNoteIds = ref<Misskey.entities.Note['id'][]>([]);
// 連合するチャンネルのハッシュタグ (先頭の「#」は含めない)。まだ決まっていないときは空で、保存時にサーバーが決める
const federationHashtag = ref('');

// ハッシュタグを指定して作るときは、連合する設定で始める (連合しないとハッシュタグを使わないため)
if (props.channelId == null) {
	if (props.initialName != null) name.value = props.initialName;
	if (props.initialFederationHashtag != null && props.initialFederationHashtag !== '') {
		federationPolicy.value = 'public';
		federationHashtag.value = props.initialFederationHashtag.replace(/^#/, '');
	}
}

watch(federationPolicy, () => {
	// 連合するチャンネルのノートは外のサーバーでリノートできるので、チャンネル外へのリノートの禁止とは両立しない。
	// 連合するあいだは、チャンネル外へのリノートの許可を ON に固定する (スイッチは操作できなくなる)
	if (federationPolicy.value === 'public') {
		allowRenoteToExternal.value = true;
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
	federationHashtag.value = result.federationHashtag ?? '';

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
	// 連合の設定が変わる場合は確認する。
	// 連合する方向 (none → public) は「外に出る」旨、
	// 連合をやめる方向 (public → none) は「配信済みは取り消せない」旨を伝える。
	const prev = channel.value?.federationPolicy ?? 'none';
	const next = federationPolicy.value;
	if (prev === 'none' && next === 'public') {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._channel.federationPolicy,
			text: i18n.ts._channel.federationPolicyEnableConfirm,
		});
		if (canceled) return;
	} else if (prev === 'public' && next === 'none') {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._channel.federationPolicy,
			text: i18n.ts._channel.federationPolicyDisableConfirm,
		});
		if (canceled) return;
	}

	// ハッシュタグを変えると、リモートのユーザーのミュートやフォローが外れるので確認する
	const prevHashtag = channel.value?.federationHashtag ?? null;
	const nextHashtag = federationHashtag.value.trim().replace(/^#/, '');
	// 欄が出ているのは連合するときだけなので、連合しないときは書き換えた値があっても送らない
	const hashtagChanged = federationPolicy.value === 'public' && prevHashtag != null && nextHashtag !== '' && nextHashtag !== prevHashtag;
	if (hashtagChanged) {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._channel.federationHashtag,
			text: i18n.ts._channel.federationHashtagChangeConfirm,
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
			...(hashtagChanged ? { federationHashtag: nextHashtag } : {}),
		}).then(updated => {
			// 保存後に手元の状態を更新し、続けて編集した場合に確認ダイアログの判定が古くならないようにする
			channel.value = updated;
			federationHashtag.value = updated.federationHashtag ?? '';
		});
	} else {
		os.apiWithDialog('channels/create', {
			...params,
			// 空のときはサーバーがチャンネル名から決める
			...(federationPolicy.value === 'public' && nextHashtag !== '' ? { federationHashtag: nextHashtag } : {}),
		}).then(created => {
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
