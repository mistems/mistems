<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" :style="tab === 'contents' ? '--MI_SPACER-w: 1400px' : '--MI_SPACER-w: 700px'">
		<div class="jqqmcavi">
			<MkButton v-if="pageId && author != null" class="button" inline type="routerLink" :to="`/@${ author.username }/pages/${ currentName }`"><i class="ti ti-external-link"></i> {{ i18n.ts._pages.viewPage }}</MkButton>
			<MkButton v-if="!readonly" inline primary class="button" @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
			<MkButton v-if="pageId" inline class="button" @click="duplicate"><i class="ti ti-copy"></i> {{ i18n.ts.duplicate }}</MkButton>
			<MkButton v-if="pageId && !readonly" inline class="button" danger @click="del"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
		</div>

		<NestedRouterView/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, provide, watch, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import { mainRouter, useRouter } from '@/router.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { pageEditorInjectionKey } from '@/pages/page-editor/common.js';
import { genId } from '@/utility/id.js';

const props = defineProps<{
	initPageId?: string;
	initPageName?: string;
	initUser?: string;
}>();

const router = useRouter();

const author = ref<Misskey.entities.User | null>($i);
const readonly = ref(false);
const page = ref<Misskey.entities.Page | null>(null);
const pageId = ref<string | null>(null);
const currentName = ref<string | null>(null);
const title = ref('');
const summary = ref<string | null>(null);
const name = ref(Date.now().toString());
const eyeCatchingImage = ref<Misskey.entities.DriveFile | null>(null);
const eyeCatchingImageId = ref<string | null>(null);
const {
	model: font,
} = useMkSelect({
	items: [
		{ label: i18n.ts._pages.fontSansSerif, value: 'sans-serif' },
		{ label: i18n.ts._pages.fontSerif, value: 'serif' },
	],
	initialValue: 'sans-serif',
});
const content = ref<Misskey.entities.Page['content']>([]);
const alignCenter = ref(false);
const hideTitleWhenPinned = ref(false);

const pageEditorFiles = ref<Record<string, Misskey.entities.DriveFile>>({});

const tab = computed({
	get: () => {
		const childName = router.currentRef.value.child?.route.name;
		return (childName === 'page-new-meta' || childName === 'page-edit-meta') ? 'settings' : 'contents';
	},
	set: (v) => {
		const base = pageId.value ? `/pages/edit/${pageId.value}` : '/pages/new';
		mainRouter.replaceByPath(v === 'settings' ? `${base}/meta` : base);
	},
});

provide('readonly', readonly.value);
provide('pageEditorFiles', pageEditorFiles);

const previewPage = computed<Misskey.entities.Page>(() => ({
	id: 'preview',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	userId: $i?.id ?? '',
	user: ($i ?? {}) as Misskey.entities.UserLite,
	content: content.value,
	variables: [],
	title: title.value,
	name: name.value,
	summary: summary.value,
	hideTitleWhenPinned: hideTitleWhenPinned.value,
	alignCenter: alignCenter.value,
	font: font.value as 'serif' | 'sans-serif',
	script: '',
	eyeCatchingImageId: eyeCatchingImageId.value,
	eyeCatchingImage: eyeCatchingImage.value,
	attachedFiles: Object.values(pageEditorFiles.value),
	likedCount: 0,
	isLiked: false,
}));

provide(pageEditorInjectionKey, {
	readonly,
	title,
	summary,
	name,
	font,
	content,
	alignCenter,
	hideTitleWhenPinned,
	eyeCatchingImageId,
	eyeCatchingImage,
	previewPage,
	author,
});

watch(eyeCatchingImageId, async () => {
	if (eyeCatchingImageId.value == null) {
		eyeCatchingImage.value = null;
	} else {
		eyeCatchingImage.value = await misskeyApi('drive/files/show', {
			fileId: eyeCatchingImageId.value,
		});
	}
});

function serializeState(): string {
	return JSON.stringify({
		title: title.value,
		summary: summary.value,
		name: name.value,
		font: font.value,
		content: content.value,
		alignCenter: alignCenter.value,
		hideTitleWhenPinned: hideTitleWhenPinned.value,
		eyeCatchingImageId: eyeCatchingImageId.value,
	});
}

const savedStateSnapshot = ref<string | null>(null);

function markClean() {
	savedStateSnapshot.value = serializeState();
}

const isDirty = computed(() => {
	if (savedStateSnapshot.value == null) return false;
	return serializeState() !== savedStateSnapshot.value;
});

// --- leave guard ---

function onBeforeUnload(ev: BeforeUnloadEvent) {
	if (isDirty.value) {
		ev.preventDefault();
		ev.returnValue = '';
	}
}
window.addEventListener('beforeunload', onBeforeUnload);

const prevNavHook = mainRouter.navHook;
mainRouter.navHook = (path, flag) => {
	if (isDirty.value) {
		const base = pageId.value ? `/pages/edit/${pageId.value}` : '/pages/new';
		const isTabSwitch = path === base || path === `${base}/meta`;
		if (!isTabSwitch) {
			if (!window.confirm(i18n.ts.leaveConfirm)) {
				return true;
			}
			markClean();
		}
	}
	if (prevNavHook) return prevNavHook(path, flag);
	return false;
};

onUnmounted(() => {
	window.removeEventListener('beforeunload', onBeforeUnload);
	mainRouter.navHook = prevNavHook;
});

// --- save / delete / duplicate ---

function getSaveOptions(): Misskey.entities.PagesCreateRequest {
	return {
		title: title.value.trim(),
		name: name.value.trim(),
		summary: summary.value,
		font: font.value,
		script: '',
		hideTitleWhenPinned: hideTitleWhenPinned.value,
		alignCenter: alignCenter.value,
		content: content.value,
		variables: [],
		eyeCatchingImageId: eyeCatchingImageId.value,
	};
}

async function save() {
	const options = getSaveOptions();

	if (pageId.value) {
		const updateOptions: Misskey.entities.PagesUpdateRequest = {
			pageId: pageId.value,
			...options,
		};

		await os.apiWithDialog('pages/update', updateOptions, undefined, {
			'2298a392-d4a1-44c5-9ebb-ac1aeaa5a9ab': {
				title: i18n.ts.somethingHappened,
				text: i18n.ts._pages.nameAlreadyExists,
			},
		});

		currentName.value = name.value.trim();
		markClean();
	} else {
		const created = await os.apiWithDialog('pages/create', options, undefined, {
			'4650348e-301c-499a-83c9-6aa988c66bc1': {
				title: i18n.ts.somethingHappened,
				text: i18n.ts._pages.nameAlreadyExists,
			},
		});

		pageId.value = created.id;
		currentName.value = name.value.trim();
		markClean();
		mainRouter.replaceByPath(`/pages/edit/${pageId.value}${tab.value === 'settings' ? '/meta' : ''}`);
	}
}

async function del() {
	if (!pageId.value) return;

	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.removeAreYouSure({ x: title.value.trim() }),
	});

	if (canceled) return;

	await os.apiWithDialog('pages/delete', {
		pageId: pageId.value,
	});

	markClean();
	mainRouter.replace('/pages');
}

async function duplicate() {
	title.value = title.value + ' - copy';
	name.value = name.value + '-copy';

	const created = await os.apiWithDialog('pages/create', getSaveOptions(), undefined, {
		'4650348e-301c-499a-83c9-6aa988c66bc1': {
			title: i18n.ts.somethingHappened,
			text: i18n.ts._pages.nameAlreadyExists,
		},
	});

	pageId.value = created.id;
	currentName.value = name.value.trim();

	mainRouter.pushByPath(`/pages/edit/${pageId.value}${tab.value === 'settings' ? '/meta' : ''}`);
}

async function init() {
	if (props.initPageId) {
		page.value = await misskeyApi('pages/show', {
			pageId: props.initPageId,
		});
	} else if (props.initPageName && props.initUser) {
		page.value = await misskeyApi('pages/show', {
			name: props.initPageName,
			username: props.initUser,
		});
		readonly.value = true;
	}

	if (page.value) {
		author.value = page.value.user;
		pageId.value = page.value.id;
		title.value = page.value.title;
		name.value = page.value.name;
		currentName.value = page.value.name;
		summary.value = page.value.summary;
		font.value = page.value.font;
		hideTitleWhenPinned.value = page.value.hideTitleWhenPinned;
		alignCenter.value = page.value.alignCenter;
		content.value = page.value.content;
		eyeCatchingImageId.value = page.value.eyeCatchingImageId;
		for (const file of page.value.attachedFiles) {
			pageEditorFiles.value[file.id] = file;
		}
	} else {
		const id = genId();
		content.value = [{
			id,
			type: 'text',
			text: 'Hello World!',
		}];
	}
}

init().then(markClean);

const headerActions = computed(() => []);

const headerTabs = computed(() => [{
	key: 'settings',
	title: i18n.ts._pages.pageSetting,
	icon: 'ti ti-settings',
}, {
	key: 'contents',
	title: i18n.ts._pages.contents,
	icon: 'ti ti-note',
}]);

definePage(() => ({
	title: props.initPageId ? i18n.ts._pages.editPage
	: props.initPageName && props.initUser ? i18n.ts._pages.readPage
	: i18n.ts._pages.newPage,
	icon: 'ti ti-pencil',
}));
</script>

<style lang="scss" scoped>
.jqqmcavi {
	margin-bottom: 16px;

	> .button {
		& + .button {
			margin-left: 8px;
		}
	}
}
</style>
