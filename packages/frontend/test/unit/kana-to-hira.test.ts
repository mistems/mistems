/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { EmojiDef } from '@/utility/search-emoji.js';
import { searchEmojiKanaInsensitive, toKanaToHira } from '@/utility/kana-to-hira.js';

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

describe('searchEmojiKanaInsensitive', () => {
	// custom-emojis.ts がエイリアスをひらがな・小文字にそろえた後の状態を再現する
	const emojiDb: EmojiDef[] = [
		{ name: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'ねこ', aliasOf: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'inu', emoji: ':inu:', isCustomEmoji: true },
		{ name: 'いぬ', aliasOf: 'inu', emoji: ':inu:', isCustomEmoji: true },
		// Unicode 絵文字の名前など、カタカナのまま残る項目
		{ name: 'ネクタイ', emoji: '👔' },
	];

	test('カタカナの検索語でも、ひらがなにそろえたエイリアスに当たる', () => {
		expect(searchEmojiKanaInsensitive('ネコ', emojiDb).map(x => x.emoji)).toContain(':neko:');
	});

	test('ひらがな・名前の検索語でも当たる', () => {
		expect(searchEmojiKanaInsensitive('ねこ', emojiDb).map(x => x.emoji)).toContain(':neko:');
		expect(searchEmojiKanaInsensitive('neko', emojiDb).map(x => x.emoji)).toContain(':neko:');
	});

	test('カタカナのまま残る項目は、元の検索語で当たる', () => {
		expect(searchEmojiKanaInsensitive('ネクタイ', emojiDb).map(x => x.emoji)).toContain('👔');
	});

	test('同じ絵文字は重複しない', () => {
		const emojis = searchEmojiKanaInsensitive('ネ', emojiDb).map(x => x.emoji);
		expect(new Set(emojis).size).toBe(emojis.length);
	});

	test('件数は max を超えない', () => {
		expect(searchEmojiKanaInsensitive('ネ', emojiDb, 1)).toHaveLength(1);
	});

	test('検索語が空なら空', () => {
		expect(searchEmojiKanaInsensitive('', emojiDb)).toEqual([]);
		expect(searchEmojiKanaInsensitive(null, emojiDb)).toEqual([]);
	});
});
