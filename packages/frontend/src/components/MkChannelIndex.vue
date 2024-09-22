<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div style="position: relative;">
	<ul style="display:flex">
		<div>★：お気に入り済み　</div>
		<div>↑：フォロー済み　</div>
		<div>▲：センシティブ</div>
	</ul>

	チャンネル総数 - {{allChannels.length}}

	<button @click="viewMode = 'legacy'">Legacy</button>
	<button @click="viewMode = 'listed'">Listed</button>
	<button @click="viewMode = 'modan'">Modan</button>


	<div :style="{display: viewMode === 'legacy' ? 'flex': 'block', flexWrap: viewMode === 'legacy' ? 'wrap' : 'nowrap'}">
		<div v-for="channel in viewChannels" :key="channel.id" style="margin-right: 8px">
			<MkA v-if="viewMode !== 'modan'" :to="`/channels/${channel.id}`">
				<span v-if="channel.isSensitive">▲</span><span v-if="channel.isFavorited">★</span><span v-if="channel.isFollowing">↑</span>
				{{channel.name}}({{channel.notesCount}})
			</MkA>
			<MkChannelPreview v-else class="_margin" :channel="channel"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import {computed, onMounted, ref, watch} from 'vue';
// import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import {misskeyApi} from "@/scripts/misskey-api.js";
import {Channel} from "../../../misskey-js/built/autogen/models.js";
import MkChannelPreview from "@/components/MkChannelPreview.vue";

const viewMode = ref<"legacy" | "listed" | "modan">("legacy");

const allChannels = ref<Channel[]>([])
const viewChannels = computed(() => {
	return allChannels.value.toSorted((a: Channel, b: Channel) => {
		if(a.lastNotedAt === null) return +1
		if(b.lastNotedAt === null) return -1


		return new Date(b.lastNotedAt) - new Date(a.lastNotedAt)

	})
})

let isLast = false

onMounted(async () => {
	let maxLoop = 10
	const times = new Array(maxLoop)
	let loopCount = 0
	const limit = 100
	while(loopCount < maxLoop) {
		loopCount++
		// 最後じゃない, maxLoopに到達してない
		const lastChannel = allChannels.value.at(-1)

		console.log(lastChannel?.id)
		const res = await misskeyApi("channels/search",{
			allowPartial: true,
			limit: limit,
			query: "",
			type: "nameAndDescription",
			untilId: lastChannel?.id,
		})
		allChannels.value = allChannels.value.concat(res)
		// responseの件数がlimitと同じ件数なら末尾に到達しているとみなす
		if(limit !== res.length) break
	}
})



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
