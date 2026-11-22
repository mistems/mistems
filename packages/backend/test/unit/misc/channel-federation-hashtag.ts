/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildChannelFederationHashtag,
	CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH,
	extractChannelFederationHashtagsFromText,
	isChannelFederationHashtag,
	isValidChannelFederationHashtag,
	sanitizeChannelFederationHashtagPart,
	stripTrailingChannelFederationHashtag,
} from '@/misc/channel-federation-hashtag.js';
import { ChannelFederationHashtagService } from '@/core/ChannelFederationHashtagService.js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import type { ChannelsRepository } from '@/models/_.js';

const length = (s: string) => Array.from(s).length;

describe('channel-federation-hashtag', () => {
	describe('stripTrailingChannelFederationHashtag', () => {
		const tag = '連合チャンネル_雑談';

		test('末尾にあるチャンネルのハッシュタグ (付記) を取り除く', () => {
			expect(stripTrailingChannelFederationHashtag('hello\n\n#連合チャンネル_雑談', tag)).toBe('hello');
		});

		test('末尾の空白・改行は無視して取り除く', () => {
			expect(stripTrailingChannelFederationHashtag('hello #連合チャンネル_雑談 \n', tag)).toBe('hello');
		});

		test('大文字・小文字や全角・半角の違いは正規化して比べる', () => {
			expect(stripTrailingChannelFederationHashtag('hello\n\n#連合チャンネル_ＡＢＣ', '連合チャンネル_abc')).toBe('hello');
		});

		test('本文の途中にあるものは残す', () => {
			expect(stripTrailingChannelFederationHashtag('#連合チャンネル_雑談 の話をする', tag)).toBe('#連合チャンネル_雑談 の話をする');
		});

		test('途中と末尾の両方にあれば、末尾のものだけを取り除く', () => {
			expect(stripTrailingChannelFederationHashtag('#連合チャンネル_雑談 の話\n\n#連合チャンネル_雑談', tag)).toBe('#連合チャンネル_雑談 の話');
		});

		test('末尾にあっても、ほかのハッシュタグは残す', () => {
			expect(stripTrailingChannelFederationHashtag('hello #連合チャンネル_告知', tag)).toBe('hello #連合チャンネル_告知');
			expect(stripTrailingChannelFederationHashtag('hello #雑談', tag)).toBe('hello #雑談');
		});

		test('前方一致だけのハッシュタグは残す', () => {
			expect(stripTrailingChannelFederationHashtag('hello #連合チャンネル_雑談部', tag)).toBe('hello #連合チャンネル_雑談部');
		});

		test('ハッシュタグの前に空白がない (語の途中) ものは残す', () => {
			expect(stripTrailingChannelFederationHashtag('hello#連合チャンネル_雑談', tag)).toBe('hello#連合チャンネル_雑談');
		});

		test('ハッシュタグだけのノートは、空にしないでそのまま残す', () => {
			expect(stripTrailingChannelFederationHashtag('#連合チャンネル_雑談', tag)).toBe('#連合チャンネル_雑談');
		});
	});

	describe('sanitizeChannelFederationHashtagPart', () => {
		test('文字・数字・下線以外を取り除く', () => {
			expect(sanitizeChannelFederationHashtagPart('「雑談」・告知 A.B-C_1!')).toBe('雑談告知ABC_1');
		});
	});

	describe('buildChannelFederationHashtag', () => {
		test('チャンネル名から作り、サーバー名は入れない', () => {
			expect(buildChannelFederationHashtag({
				channelName: '「雑談」',
				channelId: 'abcdefghij',
			})).toBe('連合チャンネル_雑談');
		});

		test('チャンネル名が使えない文字だけなら ID の末尾 6 文字を使う', () => {
			expect(buildChannelFederationHashtag({
				channelName: '!!! ???',
				channelId: 'aaaaa0123456',
			})).toBe('連合チャンネル_123456');
		});

		test('重なったときは _2、_3 を付ける', () => {
			const base = { channelName: '雑談', channelId: 'abcdefghij' };
			expect(buildChannelFederationHashtag({ ...base, suffix: 1 })).toBe('連合チャンネル_雑談');
			expect(buildChannelFederationHashtag({ ...base, suffix: 2 })).toBe('連合チャンネル_雑談_2');
			expect(buildChannelFederationHashtag({ ...base, suffix: 3 })).toBe('連合チャンネル_雑談_3');
		});

		test('長いチャンネル名を切り詰めて 128 文字に収める', () => {
			const tag = buildChannelFederationHashtag({
				channelName: 'あ'.repeat(200),
				channelId: 'abcdefghij',
				suffix: 12,
			});
			expect(length(tag)).toBe(CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH);
			expect(tag.startsWith('連合チャンネル_あ')).toBe(true);
			expect(tag.endsWith('あ_12')).toBe(true);
			expect(isValidChannelFederationHashtag(tag)).toBe(true);
		});

		test('サロゲートペアの文字も 1 文字として数え、途中で切らない', () => {
			const tag = buildChannelFederationHashtag({
				channelName: '𩸽'.repeat(200),
				channelId: 'abcdefghij',
			});
			expect(length(tag)).toBe(CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH);
			expect(tag.endsWith('𩸽')).toBe(true);
		});
	});

	describe('extractChannelFederationHashtagsFromText', () => {
		test('本文の付記から、連合するチャンネルの形をしたハッシュタグだけを取り出す', () => {
			expect(extractChannelFederationHashtagsFromText('hello #cats\n\nFrom: 「雑談」 #連合チャンネル_雑談 https://a.test/channels/x'))
				.toEqual(['連合チャンネル_雑談']);
		});

		test('目印がなければ空', () => {
			expect(extractChannelFederationHashtagsFromText('hello #cats')).toEqual([]);
			expect(extractChannelFederationHashtagsFromText(null)).toEqual([]);
		});

		test('コードの中の「#…」は拾わない', () => {
			expect(extractChannelFederationHashtagsFromText('`#連合チャンネル_雑談`')).toEqual([]);
		});
	});

	describe('isValidChannelFederationHashtag', () => {
		test('文字・数字・下線だけで 128 文字以内なら使える', () => {
			expect(isValidChannelFederationHashtag('連合チャンネル_雑談_2')).toBe(true);
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
			expect(isChannelFederationHashtag('連合チャンネル_雑談')).toBe(true);
			expect(isChannelFederationHashtag('連合ﾁｬﾝﾈﾙ_雑談')).toBe(true);
			expect(isChannelFederationHashtag('雑談')).toBe(false);
		});
	});

	describe('ChannelFederationHashtagService.generate', () => {
		function createService(takenTags: string[]) {
			const taken = new Set(takenTags.map(t => normalizeTag(t)));
			const repository = {
				exists: async ({ where }: { where: { federationHashtagNormalized: string } }) => taken.has(where.federationHashtagNormalized),
			} as unknown as ChannelsRepository;
			return new ChannelFederationHashtagService(repository);
		}

		test('重ならなければそのまま使う', async () => {
			const service = createService([]);
			expect(await service.generate({ id: 'abcdefghij', name: '雑談' })).toBe('連合チャンネル_雑談');
		});

		test('このサーバーのほかのチャンネルと重なったら _2、_3 を付ける (全角・半角の違いも重なりとみなす)', async () => {
			const service = createService(['連合ﾁｬﾝﾈﾙ_雑談', '連合チャンネル_雑談_2']);
			expect(await service.generate({ id: 'abcdefghij', name: '雑談' })).toBe('連合チャンネル_雑談_3');
		});
	});
});
