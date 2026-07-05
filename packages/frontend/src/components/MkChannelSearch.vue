<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div style="position: relative;">

	<div style="display:flex">
		<div>チャンネル総数 - {{ viewChannels.length }}</div>
	
	</div>
	<div style="margin: 16px 0;">
		<input type="text" v-model="searchQuery" placeholder="チャンネルを検索..." style="width: 100%; padding: 8px; border: 1px solid var(--divider); border-radius: 4px;" />
	</div>
	


	<div>
		<div style="font-weight: bold; margin-bottom: 8px;">検索結果: {{ searchedChannels.length }} (検索対象はタブを閉じると更新)</div>
    <MkSwitch v-model="showSensitive"> センシティブチャンネルも表示する</MkSwitch>
	
		<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
			<div v-for="channel in searchedChannels" :key="channel.id" style="margin-bottom: 8px;">
				<MkChannelPreview class="_margin" :channel="channel"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import type { Channel } from '../../../misskey-js/built/autogen/models.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import MkSwitch from '@/components/MkSwitch.vue';
const showSensitive = ref(false);
const searchQuery = ref('');


const allChannels = ref<Channel[]>([]);

const viewChannels = computed(() => {
	return allChannels.value.filter((channel) => {
		if (showSensitive.value) return true;
		return !channel.isSensitive;
	}).toSorted((a: Channel, b: Channel) => {
		if (a.lastNotedAt === null) return +1;
		if (b.lastNotedAt === null) return -1;

		return new Date(b.lastNotedAt).getTime() - new Date(a.lastNotedAt).getTime();
	});
});

const searchedChannels = computed(() => {
	if (!searchQuery.value) return [];
	
	return allChannels.value.filter((channel) => {
		if (!showSensitive.value && channel.isSensitive) return false;
		
		const query = searchQuery.value.toLowerCase();
		return channel.name.toLowerCase().includes(query) || 
			   (channel.description && channel.description.toLowerCase().includes(query));
	}).toSorted((a: Channel, b: Channel) => {
		if (a.lastNotedAt === null) return +1;
		if (b.lastNotedAt === null) return -1;

		return new Date(b.lastNotedAt).getTime() - new Date(a.lastNotedAt).getTime();
	});
});

onMounted(async () => {
	// SessionStorageからキャッシュをチェック
	const cachedChannels = sessionStorage.getItem('allChannels');
	const cacheTimestamp = sessionStorage.getItem('allChannels_timestamp');
	const cacheExpiry = 1000 * 60 * 30; // 30分
	
	if (cachedChannels && cacheTimestamp) {
		const timestamp = parseInt(cacheTimestamp);
		const isExpired = Date.now() - timestamp > cacheExpiry;
		
		if (!isExpired) {
			// キャッシュが有効な場合は使用
			allChannels.value = JSON.parse(cachedChannels);
		} else {
			// キャッシュが期限切れの場合は削除
			sessionStorage.removeItem('allChannels');
			sessionStorage.removeItem('allChannels_timestamp');
		}
	}
	
	// キャッシュがない場合はAPIから取得
	if (allChannels.value.length === 0) {
		let maxLoop = 50;
		let loopCount = 0;
		const limit = 100;

		
		while (loopCount < maxLoop) {
			loopCount++;
			const lastChannel = allChannels.value.at(-1);
			const res = await misskeyApi('channels/search', {
				allowPartial: true,
				limit: limit,
				query: '',
				type: 'nameAndDescription',
				untilId: lastChannel?.id,
			});
			allChannels.value = allChannels.value.concat(res);
			if (limit !== res.length) break;
		}
		
		// データをSessionStorageにキャッシュ
		sessionStorage.setItem('allChannels', JSON.stringify(allChannels.value));
		sessionStorage.setItem('allChannels_timestamp', Date.now().toString());
	}
	
});



</script>

<style lang="scss" scoped>
.eftoefju {
	display: block;
	position: relative;
	overflow: hidden;
	width: 100%;

	&:hover {
		text-decoration: none;
	}

	&:focus-within {
		outline: none;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			border-radius: inherit;
			pointer-events: none;
			box-shadow: inset 0 0 0 2px var(--focus);
		}
	}

	> .banner {
		position: relative;
		width: 100%;
		height: 200px;
		background-position: center;
		background-size: cover;

		> .fade {
			position: absolute;
			bottom: 0;
			left: 0;
			width: 100%;
			height: 64px;
			background: linear-gradient(0deg, var(--panel), color(from var(--panel) srgb r g b / 0));
		}

		> .name {
			position: absolute;
			top: 16px;
			left: 16px;
			padding: 12px 16px;
			background: rgba(0, 0, 0, 0.7);
			color: #fff;
			font-size: 1.2em;
		}

		> .status {
			position: absolute;
			z-index: 1;
			bottom: 16px;
			right: 16px;
			padding: 8px 12px;
			font-size: 80%;
			background: rgba(0, 0, 0, 0.7);
			border-radius: 6px;
			color: #fff;
		}

		> .sensitiveIndicator {
			position: absolute;
			z-index: 1;
			bottom: 16px;
			left: 16px;
			background: rgba(0, 0, 0, 0.7);
			color: var(--warn);
			border-radius: 6px;
			font-weight: bold;
			font-size: 1em;
			padding: 4px 7px;
		}
	}

	> article {
		padding: 16px;

		> p {
			margin: 0;
			font-size: 1em;
		}
	}

	> footer {
		padding: 12px 16px;
		border-top: solid 0.5px var(--divider);

		> span {
			opacity: 0.7;
			font-size: 0.9em;
		}
	}

	@media (max-width: 550px) {
		font-size: 0.9em;

		> .banner {
			height: 80px;

			> .status {
				display: none;
			}
		}

		> article {
			padding: 12px;
		}

		> footer {
			display: none;
		}
	}

	@media (max-width: 500px) {
		font-size: 0.8em;

		> .banner {
			height: 70px;
		}

		> article {
			padding: 8px;
		}
	}
}

.indicator {
	position: absolute;
	top: 0;
	right: 0;
	transform: translate(25%, -25%);
	background-color: var(--accent);
	border: solid var(--bg) 4px;
	border-radius: 100%;
	width: 1.5rem;
	height: 1.5rem;
	aspect-ratio: 1 / 1;
}

</style>
