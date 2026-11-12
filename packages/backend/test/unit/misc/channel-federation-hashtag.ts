/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildChannelFederationHashtag,
	CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH,
	isChannelFederationHashtag,
	isValidChannelFederationHashtag,
	sanitizeChannelFederationHashtagPart,
} from '@/misc/channel-federation-hashtag.js';
import { ChannelFederationHashtagService } from '@/core/ChannelFederationHashtagService.js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import type { Config } from '@/config.js';
import type { ChannelsRepository, MiMeta } from '@/models/_.js';

const length = (s: string) => Array.from(s).length;

describe('channel-federation-hashtag', () => {
	describe('sanitizeChannelFederationHashtagPart', () => {
		test('文字・数字・下線以外を取り除く', () => {
			expect(sanitizeChannelFederationHashtagPart('「雑談」・告知 A.B-C_1!')).toBe('雑談告知ABC_1');
		});

		test('ドメインの「.」と「:」を取り除く', () => {
			expect(sanitizeChannelFederationHashtagPart('a.test:3000')).toBe('atest3000');
		});
	});

	describe('buildChannelFederationHashtag', () => {
		test('サーバーの表示名とチャンネル名から作る', () => {
			expect(buildChannelFederationHashtag({
				serverName: 'ゲーム ロア!',
				host: 'gamelore.example',
				channelName: '「雑談」',
				channelId: 'abcdefghij',
			})).toBe('ゲームロア連合チャンネル_雑談');
		});

		test('サーバーの表示名が空ならドメインから作る', () => {
			expect(buildChannelFederationHashtag({
				serverName: null,
				host: 'a.test',
				channelName: '雑談',
				channelId: 'abcdefghij',
			})).toBe('atest連合チャンネル_雑談');

			expect(buildChannelFederationHashtag({
				serverName: '...',
				host: 'b.test',
				channelName: '雑談',
				channelId: 'abcdefghij',
			})).toBe('btest連合チャンネル_雑談');
		});

		test('チャンネル名が使えない文字だけなら ID の末尾 6 文字を使う', () => {
			expect(buildChannelFederationHashtag({
				serverName: 'Server',
				host: 'a.test',
				channelName: '!!! ???',
				channelId: 'aaaaa0123456',
			})).toBe('Server連合チャンネル_123456');
		});

		test('重なったときは _2、_3 を付ける', () => {
			const base = { serverName: 'S', host: 'a.test', channelName: '雑談', channelId: 'abcdefghij' };
			expect(buildChannelFederationHashtag({ ...base, suffix: 1 })).toBe('S連合チャンネル_雑談');
			expect(buildChannelFederationHashtag({ ...base, suffix: 2 })).toBe('S連合チャンネル_雑談_2');
			expect(buildChannelFederationHashtag({ ...base, suffix: 3 })).toBe('S連合チャンネル_雑談_3');
		});

		test('長いチャンネル名を切り詰めて 128 文字に収める', () => {
			const tag = buildChannelFederationHashtag({
				serverName: 'Server',
				host: 'a.test',
				channelName: 'あ'.repeat(200),
				channelId: 'abcdefghij',
				suffix: 12,
			});
			expect(length(tag)).toBe(CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH);
			expect(tag.startsWith('Server連合チャンネル_あ')).toBe(true);
			expect(tag.endsWith('あ_12')).toBe(true);
			expect(isValidChannelFederationHashtag(tag)).toBe(true);
		});

		test('サロゲートペアの文字も 1 文字として数え、途中で切らない', () => {
			const tag = buildChannelFederationHashtag({
				serverName: 'S',
				host: 'a.test',
				channelName: '𩸽'.repeat(200),
				channelId: 'abcdefghij',
			});
			expect(length(tag)).toBe(CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH);
			expect(tag.endsWith('𩸽')).toBe(true);
		});

		test('サーバー名がとても長くても、チャンネル名を残して 128 文字に収める', () => {
			const tag = buildChannelFederationHashtag({
				serverName: 'S'.repeat(300),
				host: 'a.test',
				channelName: '雑談チャンネルです',
				channelId: 'abcdefghij',
			});
			expect(length(tag)).toBe(CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH);
			expect(tag.endsWith('連合チャンネル_雑談チャンネ')).toBe(true);
		});
	});

	describe('isValidChannelFederationHashtag', () => {
		test('文字・数字・下線だけで 128 文字以内なら使える', () => {
			expect(isValidChannelFederationHashtag('S連合チャンネル_雑談_2')).toBe(true);
			expect(isValidChannelFederationHashtag('a'.repeat(128))).toBe(true);
		});

		test('使えない文字・空・長すぎるものは使えない', () => {
			expect(isValidChannelFederationHashtag('')).toBe(false);
			expect(isValidChannelFederationHashtag('a.b')).toBe(false);
			expect(isValidChannelFederationHashtag('a b')).toBe(false);
			expect(isValidChannelFederationHashtag('#abc')).toBe(false);
			expect(isValidChannelFederationHashtag('a'.repeat(129))).toBe(false);
		});
	});

	describe('isChannelFederationHashtag', () => {
		test('「連合チャンネル_」を含むかで判定する (正規化してから比べる)', () => {
			expect(isChannelFederationHashtag('S連合チャンネル_雑談')).toBe(true);
			expect(isChannelFederationHashtag('S連合ﾁｬﾝﾈﾙ_雑談')).toBe(true);
			expect(isChannelFederationHashtag('雑談')).toBe(false);
		});
	});

	describe('ChannelFederationHashtagService.generate', () => {
		function createService(takenTags: string[], serverName: string | null) {
			const taken = new Set(takenTags.map(t => normalizeTag(t)));
			const repository = {
				exists: async ({ where }: { where: { federationHashtagNormalized: string } }) => taken.has(where.federationHashtagNormalized),
			} as unknown as ChannelsRepository;
			return new ChannelFederationHashtagService(
				{ host: 'a.test' } as Config,
				{ name: serverName } as MiMeta,
				repository,
			);
		}

		test('重ならなければそのまま使う', async () => {
			const service = createService([], 'Server');
			expect(await service.generate({ id: 'abcdefghij', name: '雑談' })).toBe('Server連合チャンネル_雑談');
		});

		test('ほかのチャンネルと重なったら _2、_3 を付ける (大文字・小文字の違いも重なりとみなす)', async () => {
			const service = createService(['server連合チャンネル_雑談', 'Server連合チャンネル_雑談_2'], 'Server');
			expect(await service.generate({ id: 'abcdefghij', name: '雑談' })).toBe('Server連合チャンネル_雑談_3');
		});

		test('サーバーの表示名が空ならドメインから作る', async () => {
			const service = createService([], '');
			expect(await service.generate({ id: 'abcdefghij', name: '雑談' })).toBe('atest連合チャンネル_雑談');
		});
	});
});
