/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import { file, userDetailed } from '../../.storybook/fakes.js';
import MkEmojiPreviewDialog from './MkEmojiPreviewDialog.vue';

export const Default = {
	render(args) {
		return {
			components: {
				MkEmojiPreviewDialog,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkEmojiPreviewDialog v-bind="args"/>',
		};
	},
	args: {
		url: file().url,
		name: file().name,
		user: userDetailed(),
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkEmojiPreviewDialog>;
