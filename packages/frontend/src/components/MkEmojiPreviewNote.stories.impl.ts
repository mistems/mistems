/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import lightTheme from '@@/themes/l-light.json5';
import darkTheme from '@@/themes/d-green-lime.json5';
import { file, userDetailed } from '../../.storybook/fakes.js';
import MkEmojiPreviewNote from './MkEmojiPreviewNote.vue';

export const Default = {
	render(args) {
		return {
			components: {
				MkEmojiPreviewNote,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkEmojiPreviewNote v-bind="args" style="max-width: 400px;"/>',
		};
	},
	args: {
		emojiUrl: file().url,
		emojiName: 'fedi',
		theme: lightTheme,
		label: 'Light',
		user: userDetailed(),
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkEmojiPreviewNote>;

export const Dark = {
	...Default,
	args: {
		...Default.args,
		theme: darkTheme,
		label: 'Dark',
	},
} satisfies StoryObj<typeof MkEmojiPreviewNote>;

export const WithoutUser = {
	...Default,
	args: {
		...Default.args,
		user: null,
	},
} satisfies StoryObj<typeof MkEmojiPreviewNote>;
