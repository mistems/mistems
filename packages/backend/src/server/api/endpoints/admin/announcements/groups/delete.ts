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
			id: 'fc86964a-d361-45b4-91df-e9f239b0caa2',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
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

			await this.announcementGroupService.delete(group, me);
		});
	}
}
