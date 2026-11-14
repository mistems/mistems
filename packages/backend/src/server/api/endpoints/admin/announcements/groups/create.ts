/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { AnnouncementGroupService } from '@/core/AnnouncementGroupService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:announcements',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'AnnouncementGroup',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 256 },
		icon: { type: 'string', nullable: true, maxLength: 128, default: null },
		order: { type: 'integer', default: 0 },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private announcementGroupService: AnnouncementGroupService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const group = await this.announcementGroupService.create({
				name: ps.name,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				icon: ps.icon || null,
				order: ps.order,
			}, me);

			return this.announcementGroupService.pack(group);
		});
	}
}
