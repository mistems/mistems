/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DI } from '@/di-symbols.js';
import type { NotesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import type * as Bull from 'bullmq';
import type { RefetchNoteJobData } from '../types.js';

@Injectable()
export class RefetchNoteProcessorService implements OnModuleInit {
	private logger: Logger;
	private apNoteService: ApNoteService;

	constructor(
		private moduleRef: ModuleRef,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('refetch-note');
	}

	onModuleInit(): void {
		// 循環参照のため遅延解決 / lazy resolve for circular dependency
		this.apNoteService = this.moduleRef.get(ApNoteService, { strict: false });
	}

	@bindThis
	public async process(job: Bull.Job<RefetchNoteJobData>): Promise<void> {
		const note = await this.notesRepository.findOneBy({ id: job.data.noteId });
		if (note == null) {
			return;
		}

		// TTL ガード / per-host スロットルは updateNoteIfStale 内に内包されている。
		await this.apNoteService.updateNoteIfStale(note, { force: false });
	}
}
