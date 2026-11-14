<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div v-if="tab === 'index'">
			<MkChannelIndex />
		</div>
		<div v-if="tab === 'search'" >
			<MkChannelSearch />
		</div>
		<div v-if="tab === 'featured'" key="featured">
			<MkPagination v-slot="{items}" :paginator="featuredPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'favorites'">
			<MkPagination v-slot="{items}" :paginator="favoritesPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'following'">
			<MkPagination v-slot="{items}" :paginator="followingPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'owned'" class="_gaps">
			<MkButton v-if="$i?.policies.canCreateChannel" type="routerLink" primary rounded to="/channels/new"><i class="ti ti-plus"></i> {{ i18n.ts.createNew }}</MkButton>
			<MkPagination v-slot="{items}" :paginator="ownedPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import MkChannelIndex from '@/components/MkChannelIndex.vue';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import MkChannelSearch from "@/components/MkChannelSearch.vue";
import MkPagination from '@/components/MkPagination.vue';
import MkButton from '@/components/MkButton.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';

const tab = ref('featured');

const featuredPaginator = markRaw(new Paginator('channels/featured', {
	limit: 10,
	noPaging: true,
}));
const favoritesPaginator = markRaw(new Paginator('channels/my-favorites', {
	limit: 100,
	noPaging: true,
}));
const followingPaginator = markRaw(new Paginator('channels/followed', {
	limit: 10,
}));
const ownedPaginator = markRaw(new Paginator('channels/owned', {
	limit: 10,
}));

const headerActions = computed(() => []);

const headerTabs = computed(() => [
	{
		key: 'index',
		title: 'だいたいぜんぶ',
		icon: 'ti ti-plus',
	},
	{
		key: 'search',
		title: i18n.ts.search,
		icon: 'ti ti-search',
	}, {
		key: 'featured',
		title: i18n.ts._channel.featured,
		icon: 'ti ti-comet',
	}, {
		key: 'favorites',
		title: i18n.ts.favorites,
		icon: 'ti ti-star',
	}, {
		key: 'following',
		title: i18n.ts._channel.following,
		icon: 'ti ti-eye',
	}, {
		key: 'owned',
		title: i18n.ts._channel.owned,
		icon: 'ti ti-edit',
	}]);

definePage(() => ({
	title: i18n.ts.channel,
	icon: 'ti ti-device-tv',
}));
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
	gap: var(--MI-margin);
}
</style>
