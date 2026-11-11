/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '@/GlobalModule.js';
import { CoreModule } from '@/core/CoreModule.js';
import { ApInboxService } from '@/core/activitypub/ApInboxService.js';
import { ApPersonService } from '@/core/activitypub/models/ApPersonService.js';
import { DownloadService } from '@/core/DownloadService.js';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import type { MiRemoteUser } from '@/models/User.js';
import type { TestingModule } from '@nestjs/testing';

describe('ApInboxService', () => {
	let app: TestingModule;
	let apInboxService: ApInboxService;
	let apPersonService: ApPersonService;

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		})
			.overrideProvider(DownloadService).useValue({
				async downloadUrl(): Promise<{ filename: string }> {
					return { filename: 'dummy.tmp' };
				},
			})
			.overrideProvider(DI.meta).useFactory({ factory: () => ({
				blockedHosts: [] as string[],
			}) as MiMeta })
			.compile();

		await app.init();
		app.enableShutdownHooks();

		apInboxService = app.get<ApInboxService>(ApInboxService);
		apPersonService = app.get<ApPersonService>(ApPersonService);
	});

	afterAll(async () => {
		await app.close();
	});

	test('情報が古いアクターのバックグラウンド更新が失敗しても unhandled rejection にならない', async () => {
		// 「情報が古い」条件 (lastFetchedAt が 24 時間より前) を満たすリモートアクター。
		// performActivity は渡されたオブジェクトのプロパティしか見ないため最小限で足りる
		const actor = {
			id: 'testactorid00',
			uri: 'https://remote.example.com/users/testactorid00',
			lastFetchedAt: new Date(Date.now() - 1000 * 60 * 60 * 25),
			host: 'remote.example.com',
		} as MiRemoteUser;

		// リモートが応答しない状況 (send() のタイムアウト = AbortError) を模倣
		// vi.spyOn は戻り値の Promise に結果記録用ハンドラを付けてしまい
		// unhandled rejection を再現できないため、素のモンキーパッチで差し替える
		const calls: string[] = [];
		const originalUpdatePerson = apPersonService.updatePerson;
		Object.defineProperty(apPersonService, 'updatePerson', {
			configurable: true,
			value: (uri: string) => {
				calls.push(uri);
				return Promise.reject(new Error('The operation was aborted: https://remote.example.com/users/testactorid00'));
			},
		});

		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on('unhandledRejection', onRejection);
		try {
			// 未知の type の activity はスキップ扱いで通過し、
			// 末尾の「ついでにリモートユーザーの情報が古かったら更新」ブロックに到達する
			await apInboxService.performActivity(actor, {
				id: 'https://remote.example.com/activities/1',
				type: 'UnknownTestActivity',
			});

			// fire-and-forget は setImmediate 経由なので、発火と reject の伝播を跨いで待つ
			await new Promise(resolve => setTimeout(resolve, 100));

			expect(calls).toEqual([actor.uri]);
			expect(rejections).toEqual([]);
		} finally {
			process.off('unhandledRejection', onRejection);
			Object.defineProperty(apPersonService, 'updatePerson', { configurable: true, value: originalUpdatePerson });
		}
	});
});
