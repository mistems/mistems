<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="`/@${page.user.username}/pages/${page.name}`" class="vhpxefrj">
	<div v-if="page.eyeCatchingImage" class="thumbnail">
		<MediaImage
			:image="page.eyeCatchingImage"
			:disableImageLink="true"
			:controls="false"
			:cover="true"
			:class="$style.eyeCatchingImageRoot"
		/>
	</div>
	<article>
		<header>
			<h1 :title="page.title">{{ page.title }}</h1>
		</header>
		<p v-if="page.summary" :title="page.summary">{{ page.summary.length > 85 ? page.summary.slice(0, 85) + '…' : page.summary }}</p>
		<div v-if="previewItems.length > 0" :class="$style.contentPreview">
			<template v-for="item in previewItems" :key="item.id">
				<div v-if="item.type === 'image'" :class="$style.imageBlock">
					<img :src="item.file.thumbnailUrl ?? item.file.url" :alt="item.file.name"/>
				</div>
				<div v-else-if="item.type === 'section'" :class="$style.sectionBlock">
					{{ item.title }}
				</div>
				<div v-else-if="item.type === 'note' && noteData[item.noteId]" :class="$style.noteBlock">
					<div :class="$style.noteHeader">
						<img v-if="noteData[item.noteId].user.avatarUrl" :class="$style.noteAvatar" :src="noteData[item.noteId].user.avatarUrl"/>
						<span :class="$style.noteUserName">{{ userName(noteData[item.noteId].user) }}</span>
					</div>
					<div v-if="noteData[item.noteId].text" :class="$style.noteText">
						{{ truncateText(noteData[item.noteId].text, 100) }}
					</div>
				</div>
			</template>
		</div>
		<footer>
			<img v-if="page.user.avatarUrl" class="icon" :src="page.user.avatarUrl"/>
			<p>{{ userName(page.user) }}</p>
		</footer>
	</article>
</MkA>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { userName } from '@/filters/user.js';
import MediaImage from '@/components/MkMediaImage.vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	page: Misskey.entities.Page;
}>();

type PreviewItem =
	| { type: 'image'; id: string; file: Misskey.entities.DriveFile }
	| { type: 'section'; id: string; title: string }
	| { type: 'note'; id: string; noteId: string };

const MAX_PREVIEW_ITEMS = 4;

const previewItems = computed<PreviewItem[]>(() => {
	const items: PreviewItem[] = [];

	function collect(blocks: Misskey.entities.PageBlock[]) {
		for (const block of blocks) {
			if (items.length >= MAX_PREVIEW_ITEMS) return;

			if (block.type === 'image') {
				const file = props.page.attachedFiles.find(f => f.id === block.fileId);
				if (file) {
					items.push({ type: 'image', id: block.id, file });
				}
			} else if (block.type === 'section') {
				if (block.title) {
					items.push({ type: 'section', id: block.id, title: block.title });
				}
				collect(block.children);
			} else if (block.type === 'note') {
				if (block.note) {
					items.push({ type: 'note', id: block.id, noteId: block.note });
				}
			}
		}
	}

	collect(props.page.content);
	return items;
});

function truncateText(text: string | null, maxLength: number): string {
	if (!text) return '';
	return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

const noteData = ref<Record<string, Misskey.entities.Note>>({});

watch(previewItems, async (items) => {
	const noteIds = items
		.filter((i): i is Extract<PreviewItem, { type: 'note' }> => i.type === 'note')
		.map(i => i.noteId);
	const newIds = noteIds.filter(id => !(id in noteData.value));
	if (newIds.length === 0) return;

	const results = { ...noteData.value };
	await Promise.all(newIds.map(async (id) => {
		try {
			results[id] = await misskeyApi('notes/show', { noteId: id });
		} catch { /* ignore */ }
	}));
	noteData.value = results;
}, { immediate: true, flush: 'post' });
</script>

<style lang="scss" module>
.eyeCatchingImageRoot {
	width: 100%;
	height: 200px;
	border-radius: var(--MI-radius) var(--MI-radius) 0 0;
	overflow: hidden;
}

.contentPreview {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 8px;
}

.imageBlock {
	border-radius: 6px;
	overflow: hidden;
	max-height: 120px;

	> img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
}

.sectionBlock {
	font-size: 0.85em;
	font-weight: 600;
	color: var(--MI_THEME-fg);
	padding: 4px 0;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.noteBlock {
	background: var(--MI_THEME-bg);
	border-radius: 6px;
	padding: 8px;
}

.noteHeader {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 4px;
}

.noteAvatar {
	width: 16px;
	height: 16px;
	border-radius: 50%;
}

.noteUserName {
	font-weight: 600;
	font-size: 0.75em;
}

.noteText {
	font-size: 0.8em;
	color: var(--MI_THEME-fg);
	line-height: 1.4;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	-webkit-box-orient: vertical;
}
</style>

<style lang="scss" scoped>
.vhpxefrj {
	display: block;
	position: relative;

	&:hover {
		text-decoration: none;
		color: var(--MI_THEME-accent);
	}

	&:focus-within {
		outline: none;

		&::after {
			content: "";
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			border-radius: var(--MI-radius);
			pointer-events: none;
			box-shadow: inset 0 0 0 2px var(--MI_THEME-focus);
		}
	}

	> .thumbnail {
		& + article {
			border-radius: 0 0 var(--MI-radius) var(--MI-radius);
		}
	}

	> article {
		background-color: var(--MI_THEME-panel);
		padding: 16px;
		border-radius: var(--MI-radius);

		> header {
			margin-bottom: 8px;

			> h1 {
				margin: 0;
				font-size: 1em;
				color: var(--urlPreviewTitle);
			}
		}

		> p {
			margin: 0;
			color: var(--urlPreviewText);
			font-size: 0.8em;
		}

		> footer {
			margin-top: 8px;
			height: 16px;

			> img {
				display: inline-block;
				width: 16px;
				height: 16px;
				margin-right: 4px;
				vertical-align: top;
			}

			> p {
				display: inline-block;
				margin: 0;
				font-size: 0.8em;
				line-height: 16px;
				vertical-align: top;
			}
		}
	}

	@media (max-width: 700px) {
		> .thumbnail {
			position: relative;
			width: 100%;
			height: 100px;

			& + article {
				left: 0;
			}
		}
	}

	@media (max-width: 550px) {
		font-size: 12px;

		> .thumbnail {
			height: 80px;
			overflow: clip;
		}

		> article {
			padding: 12px;
		}
	}

	@media (max-width: 500px) {
		font-size: 10px;

		> .thumbnail {
			height: 70px;
		}

		> article {
			padding: 8px;

			> header {
				margin-bottom: 4px;
			}

			> footer {
				margin-top: 4px;

				> img {
					width: 12px;
					height: 12px;
				}
			}
		}
	}
}
</style>
