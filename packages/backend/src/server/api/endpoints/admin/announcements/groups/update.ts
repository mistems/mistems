/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AnnouncementGroupsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { AnnouncementGroupService } from '@/core/AnnouncementGroupService.js';
import { ApiError } from '../../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:announcements',

	errors: {
		noSuchGroup: {
			message: 'No such announcement group.',
			code: 'NO_SUCH_GROUP',
			id: '2798bc48-4dc1-4d44-811d-9795d5bc03be',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'AnnouncementGroup',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 256 },
		icon: { type: 'string', nullable: true, maxLength: 128 },
		order: { type: 'integer' },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.announcementGroupsRepository)
		private announcementGroupsRepository: AnnouncementGroupsRepository,

		private announcementGroupService: AnnouncementGroupService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const group = await this.announcementGroupsRepository.findOneBy({ id: ps.id });
			if (group == null) throw new ApiError(meta.errors.noSuchGroup);

			const after = await this.announcementGroupService.update(group, {
				name: ps.name,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				icon: ps.icon === undefined ? undefined : (ps.icon || null),
				order: ps.order,
			}, me);

			return this.announcementGroupService.pack(after);
		});
	}
}
