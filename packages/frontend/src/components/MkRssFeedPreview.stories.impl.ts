/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { HttpResponse, http } from 'msw';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkRssFeedPreview from './MkRssFeedPreview.vue';
import type { StoryObj } from '@storybook/vue3';

const render: StoryObj<typeof MkRssFeedPreview>['render'] = (args) => ({
	components: { MkRssFeedPreview },
	setup() {
		return { args };
	},
	template: '<div style="width: 400px;"><MkRssFeedPreview v-bind="args"/></div>',
});

export const Default = {
	render,
	args: {
		url: 'https://example.com/feed.xml',
	},
	parameters: {
		layout: 'centered',
		msw: {
			handlers: [
				...commonHandlers,
				http.get('/api/fetch-rss', () => {
					return HttpResponse.json({
						title: 'Example News',
						items: [
							{ title: 'Misskey 2026.11.0 をリリースしました', link: 'https://example.com/1' },
							{ title: 'RSS ウィジェットの使い方', link: 'https://example.com/2' },
						],
					});
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkRssFeedPreview>;

export const Failed = {
	...Default,
	parameters: {
		...Default.parameters,
		msw: {
			handlers: [
				...commonHandlers,
				http.get('/api/fetch-rss', () => {
					return HttpResponse.json({ error: { code: 'FETCH_RSS_FAILED' } }, { status: 422 });
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkRssFeedPreview>;

export const InvalidUrl = {
	...Default,
	args: {
		url: 'not a url',
	},
} satisfies StoryObj<typeof MkRssFeedPreview>;
