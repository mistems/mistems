/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import MkRssFeedItems from './MkRssFeedItems.vue';
import type { StoryObj } from '@storybook/vue3';

const render: StoryObj<typeof MkRssFeedItems>['render'] = (args) => ({
	components: { MkRssFeedItems },
	setup() {
		return { args };
	},
	template: '<div style="width: 280px;"><MkRssFeedItems v-bind="args"/></div>',
});

export const Default = {
	render,
	args: {
		items: [
			{ title: 'Misskey 2026.11.0 をリリースしました', link: 'https://example.com/1' },
			{ title: 'RSS ウィジェットの使い方', link: 'https://example.com/2' },
			{ title: 'ステータスバーで RSS を流す', link: 'https://example.com/3' },
		],
		fetching: false,
		error: null,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkRssFeedItems>;

export const Fetching = {
	...Default,
	args: {
		...Default.args,
		items: [],
		fetching: true,
	},
} satisfies StoryObj<typeof MkRssFeedItems>;

export const Error = {
	...Default,
	args: {
		...Default.args,
		items: [],
		error: 'failed',
	},
} satisfies StoryObj<typeof MkRssFeedItems>;

export const Empty = {
	...Default,
	args: {
		...Default.args,
		items: [],
	},
} satisfies StoryObj<typeof MkRssFeedItems>;
