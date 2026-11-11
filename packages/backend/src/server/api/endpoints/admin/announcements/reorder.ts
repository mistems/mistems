/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AnnouncementsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { AnnouncementService } from '@/core/AnnouncementService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:announcements',

	errors: {
		noSuchAnnouncement: {
			message: 'No such announcement.',
			code: 'NO_SUCH_ANNOUNCEMENT',
			id: 'c880da27-0ac9-44e1-b3f3-3251de7b67dc',
		},
		announcementNotInGroup: {
			message: 'Some announcements are not in the specified group.',
			code: 'ANNOUNCEMENT_NOT_IN_GROUP',
			id: '2ee25259-c0b0-4ea6-bd49-497bd3ee9735',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		// null はグループに入っていないお知らせ
		groupId: { type: 'string', format: 'misskey:id', nullable: true },
		announcementIds: { type: 'array', minItems: 1, maxItems: 1000, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['groupId', 'announcementIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.announcementsRepository)
		private announcementsRepository: AnnouncementsRepository,

		private announcementService: AnnouncementService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const announcements = await this.announcementsRepository.findBy({ id: In(ps.announcementIds) });
			if (announcements.length !== ps.announcementIds.length) throw new ApiError(meta.errors.noSuchAnnouncement);

			// 他のグループのお知らせや、特定の利用者向けのお知らせは並べ替えの対象にしない
			if (announcements.some(a => a.groupId !== (ps.groupId ?? null) || a.userId != null)) {
				throw new ApiError(meta.errors.announcementNotInGroup);
			}

			await this.announcementService.reorder(ps.groupId ?? null, ps.announcementIds, me);
		});
	}
}
