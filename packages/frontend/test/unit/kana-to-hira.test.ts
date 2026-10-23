/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { EmojiDef } from '@/utility/search-emoji.js';
import { normalizeForEmojiSearch, searchEmojiNormalized, toKanaToHira } from '@/utility/kana-to-hira.js';

describe('toKanaToHira', () => {
	test('カタカナをひらがなにする', () => {
		expect(toKanaToHira('ネコ')).toBe('ねこ');
		expect(toKanaToHira('ヴァイオリン')).toBe('ゔぁいおりん');
	});

	test('ひらがな・英数字・記号・長音はそのまま', () => {
		expect(toKanaToHira('ねこ_neko-1')).toBe('ねこ_neko-1');
		expect(toKanaToHira('ラーメン')).toBe('らーめん');
	});
});

describe('normalizeForEmojiSearch', () => {
	test('大文字を小文字にする', () => {
		expect(normalizeForEmojiSearch('Misskey_Logo')).toBe('misskey_logo');
		expect(normalizeForEmojiSearch('UFO')).toBe('ufo');
	});

	test('全角英数を半角の小文字にする', () => {
		expect(normalizeForEmojiSearch('ＮＥＫＯ１')).toBe('neko1');
		expect(normalizeForEmojiSearch('ｎｅｋｏ')).toBe('neko');
	});

	test('カタカナ・半角カナをひらがなにする', () => {
		expect(normalizeForEmojiSearch('ネコ')).toBe('ねこ');
		expect(normalizeForEmojiSearch('ﾈｺ')).toBe('ねこ');
		expect(normalizeForEmojiSearch('OKサイン')).toBe('okさいん');
	});

	test('全角の記号・スペースを半角にする', () => {
		expect(normalizeForEmojiSearch('：ｎｅｋｏ：')).toBe(':neko:');
		expect(normalizeForEmojiSearch('ねこ　いぬ')).toBe('ねこ いぬ');
		expect(normalizeForEmojiSearch('＿')).toBe('_');
	});

	test('分けて書いた濁点を 1 文字にする', () => {
		expect(normalizeForEmojiSearch('ガ')).toBe('が');
	});

	test('同じ入力には同じ結果を返す（キャッシュしても変わらない）', () => {
		expect(normalizeForEmojiSearch('ネコ')).toBe(normalizeForEmojiSearch('ネコ'));
	});
});

describe('searchEmojiNormalized', () => {
	// custom-emojis.ts がエイリアスをひらがな・小文字にそろえた後の状態を再現する
	const emojiDb: EmojiDef[] = [
		{ name: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'ねこ', aliasOf: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'inu', emoji: ':inu:', isCustomEmoji: true },
		{ name: 'いぬ', aliasOf: 'inu', emoji: ':inu:', isCustomEmoji: true },
		{ name: 'Misskey_Logo', emoji: ':Misskey_Logo:', isCustomEmoji: true },
		// Unicode 絵文字の名前など、カタカナのまま残る項目
		{ name: 'ネクタイ', emoji: '👔' },
	];

	test('カタカナ・半角カナ・全角英数の検索語でも、ひらがなのエイリアスに当たる', () => {
		for (const query of ['ネコ', 'ﾈｺ', 'ねこ', 'neko', 'ｎｅｋｏ', 'NEKO']) {
			expect(searchEmojiNormalized(query, emojiDb).map(x => x.emoji), query).toContain(':neko:');
		}
	});

	test('大文字を含む名前に、大文字でも小文字でも当たる', () => {
		for (const query of ['Misskey', 'misskey', 'ＭＩＳＳＫＥＹ']) {
			expect(searchEmojiNormalized(query, emojiDb).map(x => x.emoji), query).toContain(':Misskey_Logo:');
		}
	});

	test('カタカナのままの項目に、カタカナでもひらがなでも当たる', () => {
		for (const query of ['ネクタイ', 'ねくたい']) {
			expect(searchEmojiNormalized(query, emojiDb).map(x => x.emoji), query).toContain('👔');
		}
	});

	test('返る項目は元の名前のまま', () => {
		const found = searchEmojiNormalized('misskey', emojiDb).find(x => x.emoji === ':Misskey_Logo:');
		expect(found?.name).toBe('Misskey_Logo');
	});

	test('同じ絵文字は重複しない', () => {
		const emojis = searchEmojiNormalized('ね', emojiDb).map(x => x.emoji);
		expect(new Set(emojis).size).toBe(emojis.length);
	});

	test('件数は max を超えない', () => {
		expect(searchEmojiNormalized('ね', emojiDb, 1)).toHaveLength(1);
	});

	test('検索語が空なら空', () => {
		expect(searchEmojiNormalized('', emojiDb)).toEqual([]);
		expect(searchEmojiNormalized(null, emojiDb)).toEqual([]);
	});
});
