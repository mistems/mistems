/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkHashtag from './MkHashtag.vue';
export const Default = {
	render(args) {
		return {
			components: {
				MkHashtag,
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
			},
			template: '<MkHashtag v-bind="props" style="color: var(--MI_THEME-hashtag);">#{{ props.hashtag }}</MkHashtag>',
		};
	},
	args: {
		to: '/tags/misskey',
		hashtag: 'misskey',
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkHashtag>;
