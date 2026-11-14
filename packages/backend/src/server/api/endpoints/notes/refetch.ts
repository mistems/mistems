/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { QueueService } from '@/core/QueueService.js';
import { ApiError } from '../../error.js';

// リモートノート再フェッチの TTL (4h)。ApNoteService.NOTE_REFETCH_TTL と同値。
const NOTE_REFETCH_TTL = 1000 * 60 * 60 * 4;

export const meta = {
	tags: ['notes'],

	requireCredential: true,

	kind: 'write:notes',

	// TTL ガードとの二重防御 (§4-1)。
	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Note',
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'b3d6a4b6-7c2a-4d6f-9b1e-2a5e6f4c0d11',
		},
		isLocalNote: {
			message: 'Cannot refetch a local note.',
			code: 'IS_LOCAL_NOTE',
			id: 'a1f2c3d4-5e6f-4708-8a9b-0c1d2e3f4a5b',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private noteEntityService: NoteEntityService,
		private getterService: GetterService,
		private queueService: QueueService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			if (note.uri == null) {
				throw new ApiError(meta.errors.isLocalNote);
			}

			// TTL 切れ (lastFetchedAt が null または TTL 超過) なら再フェッチジョブを enqueue する。
			// クールダウン中はエラーにせず黙って現状ノートを返す (§4-1 / Phase2 §3-2)。
			const fresh = note.lastFetchedAt != null
				&& Date.now() - note.lastFetchedAt.getTime() < NOTE_REFETCH_TTL;
			if (!fresh) {
				await this.queueService.enqueueRefetchNote(note.id);
			}

			// 即座に現状ノートを返す。更新はワーカー完了後に UI が notes/show 再取得で拾う。
			return await this.noteEntityService.pack(note, me, { detail: true });
		});
	}
}
