/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SearchService } from '@/core/SearchService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { RoleService } from '@/core/RoleService.js';
import { IdService } from '@/core/IdService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		unavailable: {
			message: 'Search of notes unavailable.',
			code: 'UNAVAILABLE',
			id: '0b44998d-77aa-4427-80d0-d2c9b8523011',
		},
		searchTimeout: {
			message: 'Search took too long. Try narrowing the date range and retry.',
			code: 'SEARCH_TIMEOUT',
			id: 'b6c4fe88-7c46-4f0a-9b7d-2b6d77d8f1a4',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string' },
		rangeStartAt: { type: 'integer', nullable: true },
		rangeEndAt: { type: 'integer', nullable: true },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		offset: { type: 'integer', default: 0 },
		host: {
			type: 'string',
			description: 'The local host is represented with `.`.',
		},
		userId: { type: 'string', format: 'misskey:id', nullable: true, default: null },
		channelId: { type: 'string', format: 'misskey:id', nullable: true, default: null },
		searchFrom: { type: 'string', nullable: true, default: null },
		withFiles: { type: 'boolean', nullable: true, default: null },
	},
	required: ['query'],
} as const;

// TODO: ロジックをサービスに切り出す

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private noteEntityService: NoteEntityService,
		private searchService: SearchService,
		private roleService: RoleService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : undefined);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : undefined);

			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.canSearchNotes) {
				throw new ApiError(meta.errors.unavailable);
			}

			let notes;
			try {
				notes = await this.searchService.searchNote(ps.query, me, {
					userId: ps.userId,
					channelId: ps.channelId,
					host: ps.host,
					rangeStartAt: ps.rangeStartAt,
					rangeEndAt: ps.rangeEndAt,
					searchFrom: ps.searchFrom,
					withFiles: ps.withFiles,
				}, {
					untilId: untilId,
					sinceId: sinceId,
					limit: ps.limit,
				});
			} catch (e) {
				// PostgreSQL の statement_timeout で中断されたクエリは SQLSTATE 57014 (query_canceled)
				if (e instanceof QueryFailedError && (e.driverError as { code?: string } | undefined)?.code === '57014') {
					throw new ApiError(meta.errors.searchTimeout);
				}
				throw e;
			}

			return await this.noteEntityService.packMany(notes, me);
		});
	}
}
