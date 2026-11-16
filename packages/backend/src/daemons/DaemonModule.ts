/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/CoreModule.js';
import { GlobalModule } from '@/GlobalModule.js';
import { QueueStatsService } from './QueueStatsService.js';
import { ServerStatsService } from './ServerStatsService.js';
import { DbServerStatsService } from './DbServerStatsService.js';

@Module({
	imports: [
		GlobalModule,
		CoreModule,
	],
	providers: [
		QueueStatsService,
		ServerStatsService,
		DbServerStatsService,
	],
	exports: [
		QueueStatsService,
		ServerStatsService,
		DbServerStatsService,
	],
})
export class DaemonModule {}
