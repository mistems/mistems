<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div class="_gaps">
		<MkInput
			v-model="searchQuery"
			large
			autofocus
			type="search"
			@enter.prevent="search"
		>
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
		<MkFolder :defaultOpen="false">
			<template #label>検索オプション</template>

			<div class="_gaps_m">
				<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end;">
					<MkInput v-model="rangeStartAt" type="date">
						<template #label>{{ i18n.ts._search.postFrom }}</template>
					</MkInput>
					<MkInput v-model="rangeEndAt" type="date">
						<template #label>{{ i18n.ts._search.postTo }}</template>
					</MkInput>
					<div style="display: flex; flex-wrap: wrap; gap: 8px; padding-bottom: 4px;">
						<MkButton small rounded @click="setTodayRange()">今日</MkButton>
						<MkButton small rounded @click="setRecentRange(0, 3)">直近3日間</MkButton>
						<MkButton small rounded @click="setRecentRange(1)">直近1か月</MkButton>
						<MkButton small rounded @click="setRecentRange(3)">直近3か月</MkButton>
					</div>
				</div>

				<MkRadios
					v-model="searchScope"
					:options="searchScopeDef"
				>
					<template #label>探す範囲</template>
				</MkRadios>

				<MkRadios
					v-model="searchFrom"
					:options="searchFromDef"
				>
					<template #label>検索テキスト</template>
				</MkRadios>

				<MkRadios
					v-model="withFiles"
					:options="withFilesDef"
				>
					<template #label>添付ファイル</template>
				</MkRadios>

				<div v-if="instance.federation !== 'none' && searchScope === 'server'" :class="$style.subOptionRoot">
					<MkInput
						v-model="hostInput"
						:placeholder="i18n.ts._search.serverHostPlaceholder"
						@enter.prevent="search"
					>
						<template #label>{{ i18n.ts._search.pleaseEnterServerHost }}</template>
						<template #prefix><i class="ti ti-server"></i></template>
					</MkInput>
				</div>

				<div v-if="searchScope === 'user'" :class="$style.subOptionRoot">
					<div :class="$style.userSelectLabel">{{ i18n.ts._search.pleaseSelectUser }}</div>
					<div class="_gaps">
						<div v-if="user == null" :class="$style.userSelectButtons">
							<div v-if="$i != null">
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectSelf"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i><i class="ti ti-user"></i></span>
										<span>{{ i18n.ts.selectSelf }}</span>
									</div>
								</MkButton>
							</div>
							<div :style="$i == null ? 'grid-column: span 2;' : undefined">
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectUser"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i></span>
										<span>{{ i18n.ts.selectUser }}</span>
									</div>
								</MkButton>
							</div>
						</div>
						<div v-else :class="$style.userSelectedButtons">
							<div style="overflow: hidden;">
								<MkUserCardMini
									:user="user"
									:withChart="false"
								/>
							</div>
							<div>
								<button
									class="_button"
									:class="$style.userSelectedRemoveButton"
									@click="removeUser"
								>
									<i class="ti ti-x"></i>
								</button>
							</div>
						</div>
					</div>
				</div>

				<div v-if="searchScope === 'channel'" :class="$style.subOptionRoot">
					<div :class="$style.userSelectLabel">{{ i18n.ts._search.pleaseSelectChannel }}</div>
					<div class="_gaps">
						<div v-if="channel == null" :class="$style.userSelectButtons">
							<div style="grid-column: span 2;">
								<MkButton
									transparent
									:class="$style.userSelectButton"
									:disabled="$i == null"
									@click="selectChannel"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i></span>
										<span>{{ i18n.ts.selectChannel }}</span>
									</div>
								</MkButton>
							</div>
						</div>
						<div v-else :class="$style.userSelectedButtons">
							<div style="overflow: hidden; display: flex; align-items: center; gap: 8px;">
								<i class="ti ti-device-tv"></i>
								<span>{{ channel.name }}</span>
							</div>
							<div>
								<button
									class="_button"
									:class="$style.userSelectedRemoveButton"
									@click="removeChannel"
								>
									<i class="ti ti-x"></i>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</MkFolder>
		<div>
			<MkButton
				large
				primary
				gradate
				rounded
				:disabled="
					searchParams == null
						|| !(componentBlockSearchUntil && now? componentBlockSearchUntil < now : true) // disableの条件なので逆をとる
				"
				style="margin: 0 auto;"

				@click="search"
			>
				{{ i18n.ts.search }}
				<MkTime v-if="componentBlockSearchUntil && now && componentBlockSearchUntil > now" :time="componentBlockSearchUntil"/>
			</MkButton>
		</div>
	</div>

	<div v-if="paginator">
		<div v-if="paginator.errorDetail.value?.code === 'SEARCH_TIMEOUT'" :class="$style.timeoutBanner">
			<div :class="$style.timeoutBannerText">
				<i class="ti ti-clock-exclamation"></i>
				検索が時間内に完了しませんでした。期間を絞ると速くなることがあります。
			</div>
			<div :class="$style.timeoutBannerButtons">
				<MkButton small rounded @click="narrowTodayAndRetry()">今日で再検索</MkButton>
				<MkButton small rounded @click="narrowAndRetry(0, 3)">直近3日間で再検索</MkButton>
				<MkButton small rounded @click="narrowAndRetry(1)">直近1か月で再検索</MkButton>
				<MkButton small rounded @click="narrowAndRetry(3)">直近3か月で再検索</MkButton>
			</div>
		</div>
		<div>{{ i18n.ts.searchResult }}</div>
		<MkNotesTimeline :key="`searchNotes:${key}`" :paginator="paginator"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, shallowRef, toRef } from 'vue';
import { host as localHost } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import type { MkRadiosOption } from '@/components/MkRadios.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { apLookup } from '@/utility/lookup.js';
import { useRouter } from '@/router.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInput from '@/components/MkInput.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { Paginator } from '@/utility/paginator.js';
import { favoritedChannelsCache } from '@/cache.js';

const props = withDefaults(defineProps<{
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
}>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: '',
});

const router = useRouter();

const key = ref(0);
const paginator = shallowRef<Paginator<'notes/search'> | null>(null);

const searchQuery = ref(toRef(props, 'query').value);
const hostInput = ref(toRef(props, 'host').value);
const rangeStartAt = ref<string | null>(null);
const rangeEndAt = ref<string | null>(null);

const user = shallowRef<Misskey.entities.UserDetailed | null>(null);
const channel = shallowRef<Misskey.entities.Channel | null>(null);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const noteSearchableScope = instance.noteSearchableScope ?? 'local';

//#region set user
let fetchedUser: Misskey.entities.UserDetailed | null = null;

if (props.userId) {
	fetchedUser = await misskeyApi('users/show', {
		userId: props.userId,
	}).catch(() => null);
}

if (props.username && fetchedUser == null) {
	fetchedUser = await misskeyApi('users/show', {
		username: props.username,
		...(props.host ? { host: props.host } : {}),
	}).catch(() => null);
}

if (fetchedUser != null) {
	if (!(noteSearchableScope === 'local' && fetchedUser.host != null)) {
		user.value = fetchedUser;
	}
}
//#endregion

const searchScope = ref<'all' | 'local' | 'server' | 'user' | 'channel'>((() => {
	if (user.value != null) return 'user';
	if (hostInput.value) return 'server';
	return 'local';
})());

const searchScopeDef = computed<MkRadiosOption[]>(() => {
	const options: MkRadiosOption[] = [];

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'all', label: i18n.ts._search.searchScopeAll });
	}

	options.push({ value: 'local', label: instance.federation === 'none' ? i18n.ts._search.searchScopeAll : i18n.ts._search.searchScopeLocal });

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'server', label: i18n.ts._search.searchScopeServer });
	}

	options.push({ value: 'user', label: i18n.ts._search.searchScopeUser });
	options.push({ value: 'channel', label: i18n.ts._search.searchScopeChannel });

	return options;
});

const searchFrom = ref<'text' | 'textWithCw'>('textWithCw');

const searchFromDef: MkRadiosOption[] = [
	{ value: 'text', label: '本文' },
	{ value: 'textWithCw', label: '本文+CW' },
];

const withFiles = ref<'any' | 'with' | 'without'>('any');

const withFilesDef: MkRadiosOption[] = [
	{ value: 'any', label: '指定なし' },
	{ value: 'with', label: 'あり限定' },
	{ value: 'without', label: 'なし限定' },
];

type SearchParams = {
	readonly query: string;
	readonly host?: string;
	readonly userId?: string;
	readonly channelId?: string;
	readonly rangeStartAt?: number | null;
	readonly rangeEndAt?: number | null;
	readonly searchFrom?: string;
	readonly withFiles?: boolean | null;
};

const fixHostIfLocal = (target: string | null | undefined) => {
	if (!target || target === localHost) return '.';
	return target;
};

const searchRange = () => {
	// type=date は 'YYYY-MM-DD'。ローカルタイムで「その日の 0 時 / 23:59:59.999」として扱う。
	return {
		rangeStartAt: rangeStartAt.value ? new Date(`${rangeStartAt.value}T00:00:00`).getTime() : null,
		rangeEndAt: rangeEndAt.value ? new Date(`${rangeEndAt.value}T23:59:59.999`).getTime() : null,
	};
};

function toDateString(d: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setRecentRange(months: number, days = 0): void {
	const end = new Date();
	const start = new Date(end);
	start.setMonth(start.getMonth() - months);
	start.setDate(start.getDate() - days);
	rangeStartAt.value = toDateString(start);
	rangeEndAt.value = toDateString(end);
}

function setTodayRange(): void {
	const today = new Date();
	rangeStartAt.value = toDateString(today);
	rangeEndAt.value = toDateString(today);
}

function narrowAndRetry(months: number, days = 0): void {
	setRecentRange(months, days);
	search();
}

function narrowTodayAndRetry(): void {
	setTodayRange();
	search();
}

const withFilesParam = () => {
	if (withFiles.value === 'with') return true;
	if (withFiles.value === 'without') return false;
	return null;
};

const searchParams = computed<SearchParams | null>(() => {
	const trimmedQuery = searchQuery.value.trim();
	if (!trimmedQuery) return null;

	if (searchScope.value === 'user') {
		if (user.value == null) return null;
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(user.value.host),
			userId: user.value.id,
			searchFrom: searchFrom.value,
			withFiles: withFilesParam(),
			...searchRange(),
		};
	}

	if (searchScope.value === 'channel') {
		if (channel.value == null) return null;
		return {
			query: trimmedQuery,
			channelId: channel.value.id,
			searchFrom: searchFrom.value,
			withFiles: withFilesParam(),
			...searchRange(),
		};
	}

	if (instance.federation !== 'none' && searchScope.value === 'server') {
		let trimmedHost = hostInput.value?.trim();
		if (!trimmedHost) return null;
		if (trimmedHost.startsWith('https://') || trimmedHost.startsWith('http://')) {
			try {
				trimmedHost = new URL(trimmedHost).host;
			} catch (err) { /* empty */ }
		}
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(trimmedHost),
			searchFrom: searchFrom.value,
			withFiles: withFilesParam(),
			...searchRange(),
		};
	}

	if (instance.federation === 'none' || searchScope.value === 'local') {
		return {
			query: trimmedQuery,
			host: '.',
			searchFrom: searchFrom.value,
			withFiles: withFilesParam(),
			...searchRange(),
		};
	}

	return {
		query: trimmedQuery,
		searchFrom: searchFrom.value,
		...searchRange(),
	};
});

function selectUser() {
	os.selectUser({
		includeSelf: true,
		localOnly: instance.noteSearchableScope === 'local',
	}).then(_user => {
		user.value = _user;
	});
}

function selectSelf() {
	user.value = $i;
}

function removeUser() {
	user.value = null;
}

async function selectChannel() {
	const channels = await favoritedChannelsCache.fetch();
	if (channels.length === 0) {
		await os.alert({
			type: 'info',
			text: i18n.ts._search.noFavoritedChannels,
		});
		return;
	}
	const { canceled, result: chosenChannelId } = await os.select({
		title: i18n.ts.selectChannel,
		items: channels.map(x => ({
			value: x.id, label: x.name,
		})),
		default: channel.value?.id,
	});
	if (canceled || chosenChannelId == null) return;
	channel.value = channels.find(x => x.id === chosenChannelId) ?? null;
}

function removeChannel() {
	channel.value = null;
}

const localBlockSearchUntil = localStorage.getItem('noteSearchedAt');
const componentBlockSearchUntil = ref(localBlockSearchUntil ? new Date(parseInt(localBlockSearchUntil)) : null);
const now = ref<Date | null >(new Date());

async function search() {
	if (searchParams.value == null) return;

	// バブリング防止チェック
	const noteSearchedAt = localStorage.getItem('noteSearchedAt');
	const now = Date.now();
	if (noteSearchedAt && now < parseInt(noteSearchedAt)) {
		return;
	}
	localStorage.setItem('noteSearchedAt', now.toString());
	componentBlockSearchUntil.value = new Date(now + 6 * 1000);
	console.log(componentBlockSearchUntil.value);
	window.setTimeout(() => {
		localStorage.removeItem('noteSearchedAt');
		componentBlockSearchUntil.value = null;
	}, 6 * 1000);

	//#region AP lookup
	if (searchParams.value.query.startsWith('https://') && !searchParams.value.query.includes(' ')) {
		const confirm = await os.confirm({
			type: 'info',
			text: i18n.ts.lookupConfirm,
		});
		if (!confirm.canceled) {
			const res = await apLookup(searchParams.value.query);

			if (res.type === 'User') {
				router.push('/@:acct/:page?', {
					params: {
						acct: `${res.object.username}@${res.object.host}`,
					},
				});
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			} else if (res.type === 'Note') {
				router.push('/notes/:noteId/:initialTab?', {
					params: {
						noteId: res.object.id,
					},
				});
			}

			return;
		}
	}
	//#endregion

	if (searchParams.value.query.length > 1 && !searchParams.value.query.includes(' ')) {
		if (searchParams.value.query.startsWith('@')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.lookupConfirm,
			});
			if (!confirm.canceled) {
				router.pushByPath(`/${searchParams.value.query}`);
				return;
			}
		}

		if (searchParams.value.query.startsWith('#')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.openTagPageConfirm,
			});
			if (!confirm.canceled) {
				router.push('/tags/:tag', {
					params: {
						tag: searchParams.value.query.substring(1),
					},
				});
				return;
			}
		}
	}

	paginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			...searchParams.value,
		},
	}));

	key.value++;
}
</script>
<style lang="scss" module>
.subOptionRoot {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	padding: var(--MI-margin);
}

.userSelectLabel {
	font-size: 0.85em;
	padding: 0 0 8px;
	user-select: none;
}

.sectionLabel {
	font-size: 0.85em;
	padding: 0 0 8px;
	user-select: none;
}

.timeoutBanner {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	margin-bottom: 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
}

.timeoutBannerText {
	flex: 1 1 auto;
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 200px;
}

.timeoutBannerButtons {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.userSelectButtons {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 16px;
}

.userSelectButton {
	width: 100%;
	height: 100%;
	padding: 12px;
	border: 2px dashed color(from var(--MI_THEME-fg) srgb r g b / 0.5);
}

.userSelectButtonInner {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: space-between;
	min-height: 38px;
}

.userSelectedButtons {
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: center;
}

.userSelectedRemoveButton {
	width: 32px;
	height: 32px;
	color: #ff2a2a;
}
</style>
