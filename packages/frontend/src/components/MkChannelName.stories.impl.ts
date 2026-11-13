/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkChannelName from './MkChannelName.vue';

export const Default = {
	render(args) {
		return {
			components: {
				MkChannelName,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkChannelName v-bind="args"/>',
		};
	},
	args: {
		channel: {
			name: 'Some Channel',
			federationPolicy: 'none',
		},
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkChannelName>;

export const Federated = {
	...Default,
	args: {
		channel: {
			name: 'Some Channel',
			federationPolicy: 'public',
		},
	},
} satisfies StoryObj<typeof MkChannelName>;
