/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { action } from 'storybook/actions';
import MkRemoteCaution from './MkRemoteCaution.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) {
		return {
			components: {
				MkRemoteCaution,
			},
			setup() {
				return {
					args,
				};
			},
			computed: {
				props() {
					return {
						...this.args,
					};
				},
				events() {
					return {
						refetch: action('refetch'),
					};
				},
			},
			template: '<MkRemoteCaution v-bind="props" v-on="events" />',
		};
	},
	args: {
		href: 'https://example.com',
	},
	parameters: {
		layout: 'fullscreen',
	},
} satisfies StoryObj<typeof MkRemoteCaution>;

export const Refetchable = {
	...Default,
	args: {
		href: 'https://example.com',
		refetchable: true,
		nextRefetchAt: null,
		refetchedCount: 3,
	},
} satisfies StoryObj<typeof MkRemoteCaution>;

export const Cooldown = {
	...Default,
	args: {
		href: 'https://example.com',
		refetchable: true,
		nextRefetchAt: Date.now() + 1000 * 60 * 60 * 3,
		refetchedCount: 1,
	},
} satisfies StoryObj<typeof MkRemoteCaution>;
