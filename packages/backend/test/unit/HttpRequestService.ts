/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type { Config } from '@/config.js';

describe('HttpRequestService', () => {
	let server: http.Server;
	let baseUrl: string;
	let service: HttpRequestService;

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			if (req.url === '/error-with-body') {
				// body 付きのエラー応答。send() は throwErrorWhenResponseNotOk で
				// body を読まずに throw する
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('x'.repeat(64 * 1024));
			} else if (req.url === '/ok-with-body') {
				// 成功だが呼び出し元が body を読まないケース (webhook 配送などを模倣)
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end('x'.repeat(64 * 1024));
			} else if (req.url === '/ok-hanging-body') {
				// ヘッダーと body の一部だけ送って終端しない (応答の遅い/壊れたリモートの模倣)。
				// send() はヘッダー到達時点で resolve するが、body ストリームは未完のまま残る
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.write('partial');
			} else {
				res.writeHead(404);
				res.end();
			}
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

		service = new HttpRequestService({
			userAgent: 'misskey-unit-test',
			proxyBypassHosts: [],
		} as unknown as Config);
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	// タイムアウト用のタイマーはリクエスト完了後も発火する。
	// その遅延 abort が「読み捨てられた body ストリーム」を破棄したとき、
	// unhandled rejection にならないことを検証する。
	test.each([
		['エラー応答の body を読まずに throw したケース', '/error-with-body', true],
		['成功応答の body を呼び出し元が読まないケース', '/ok-with-body', false],
		['応答が終端しないまま body を読まないケース', '/ok-hanging-body', false],
	])('タイマーの遅延 abort で unhandled rejection にならない (%s)', async (_label, path, expectsThrow) => {
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on('unhandledRejection', onRejection);
		try {
			const promise = service.send(`${baseUrl}${path}`, {
				method: 'GET',
				timeout: 300,
				isLocalAddressAllowed: true,
			});

			if (expectsThrow) {
				await expect(promise).rejects.toThrow();
			} else {
				const res = await promise;
				expect(res.ok).toBe(true);
				// body は意図的に読まない
			}

			// タイマー (300ms) の発火を跨いで待ち、遅延 abort の影響を観測する
			await new Promise(resolve => setTimeout(resolve, 900));

			expect(rejections).toEqual([]);
		} finally {
			process.off('unhandledRejection', onRejection);
		}
	});
});
