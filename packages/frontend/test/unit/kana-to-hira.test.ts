/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { EmojiDef } from '@/utility/search-emoji.js';
import { normalizeForEmojiSearch, searchEmojiNormalized, shouldOpenEmojiSuggestion, toKanaToHira } from '@/utility/kana-to-hira.js';

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

describe('searchEmojiNormalized の AND 検索', () => {
	const emojiDb: EmojiDef[] = [
		{ name: 'cat_face', emoji: ':cat_face:', isCustomEmoji: true },
		{ name: 'ねこ', aliasOf: 'cat_face', emoji: ':cat_face:', isCustomEmoji: true },
		{ name: 'かお', aliasOf: 'cat_face', emoji: ':cat_face:', isCustomEmoji: true },
		{ name: 'cat_tail', emoji: ':cat_tail:', isCustomEmoji: true },
		{ name: 'ねこ', aliasOf: 'cat_tail', emoji: ':cat_tail:', isCustomEmoji: true },
		{ name: 'dog_face', emoji: ':dog_face:', isCustomEmoji: true },
		{ name: 'かお', aliasOf: 'dog_face', emoji: ':dog_face:', isCustomEmoji: true },
	];
	const emojisOf = (q: string, max?: number) => searchEmojiNormalized(q, emojiDb, max).map(x => x.emoji);

	test('すべての語を含む絵文字だけに絞る（名前とエイリアスにまたがってよい）', () => {
		expect(emojisOf('ねこ かお')).toEqual([':cat_face:']);
		expect(emojisOf('cat かお')).toEqual([':cat_face:']);
	});

	test('語の順序に依らない', () => {
		expect(emojisOf('かお ねこ')).toEqual([':cat_face:']);
	});

	test('全角スペース・カタカナでも区切って絞る', () => {
		expect(emojisOf('ネコ　カオ')).toEqual([':cat_face:']);
	});

	test('1 語だけ当たる絵文字は出ない', () => {
		expect(emojisOf('ねこ かお')).not.toContain(':cat_tail:');
		expect(emojisOf('ねこ かお')).not.toContain(':dog_face:');
	});

	test('返る項目は代表の項目（エイリアスでない項目）', () => {
		const found = searchEmojiNormalized('ねこ かお', emojiDb)[0];
		expect(found.name).toBe('cat_face');
		expect(found.aliasOf).toBeUndefined();
	});

	test('件数は max を超えない', () => {
		expect(emojisOf('ねこ', 1)).toHaveLength(1);
		expect(emojisOf('_ face', 1)).toHaveLength(1);
	});

	test('余分なスペースは無視する', () => {
		expect(emojisOf('ねこ かお ')).toEqual([':cat_face:']);
	});
});

describe('shouldOpenEmojiSuggestion', () => {
	test('普通の検索語や空なら開く', () => {
		expect(shouldOpenEmojiSuggestion('')).toBe(true);
		expect(shouldOpenEmojiSuggestion('neko')).toBe(true);
	});

	test('スペース 1 つで区切った検索語なら開いたまま', () => {
		expect(shouldOpenEmojiSuggestion('neko inu')).toBe(true);
		expect(shouldOpenEmojiSuggestion('neko ')).toBe(true);
	});

	test('コロンの直後がスペースなら開かない', () => {
		expect(shouldOpenEmojiSuggestion(' neko')).toBe(false);
		expect(shouldOpenEmojiSuggestion(' ')).toBe(false);
	});

	test('スペースが 2 つ続いたら閉じる', () => {
		expect(shouldOpenEmojiSuggestion('neko  ')).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko  inu')).toBe(false);
	});
});
