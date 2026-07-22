/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ComputedRef, InjectionKey, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MkSelectItem } from '@/components/MkSelect.vue';
import { i18n } from '@/i18n.js';

export const pageEditorInjectionKey = Symbol() as InjectionKey<{
	readonly: Ref<boolean>;
	title: Ref<string>;
	summary: Ref<string | null>;
	name: Ref<string>;
	font: Ref<string>;
	content: Ref<Misskey.entities.Page['content']>;
	alignCenter: Ref<boolean>;
	hideTitleWhenPinned: Ref<boolean>;
	eyeCatchingImageId: Ref<string | null>;
	eyeCatchingImage: Ref<Misskey.entities.DriveFile | null>;
	previewPage: ComputedRef<Misskey.entities.Page>;
	author: Ref<Misskey.entities.User | null>;
}>;

export function getPageBlockList() {
	return [
		{ value: 'section', label: i18n.ts._pages.blocks.section },
		{ value: 'text', label: i18n.ts._pages.blocks.text },
		{ value: 'image', label: i18n.ts._pages.blocks.image },
		{ value: 'note', label: i18n.ts._pages.blocks.note },
	] as const satisfies MkSelectItem[];
}
