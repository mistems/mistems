/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { EmojiDef } from '@/utility/search-emoji.js';
import { normalizeForEmojiSearch, searchEmojiNormalized, shouldOpenEmojiSuggestion, toKanaToHira } from '@/utility/kana-to-hira.js';
import type { EmojiSuggestionState } from '@/utility/kana-to-hira.js';

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

	test('名前だけで全部の語に当たる絵文字を先に並べる', () => {
		const db: EmojiDef[] = [
			{ name: 'blob', emoji: ':blob:', isCustomEmoji: true },
			{ name: 'cat', aliasOf: 'blob', emoji: ':blob:', isCustomEmoji: true },
			{ name: 'face', aliasOf: 'blob', emoji: ':blob:', isCustomEmoji: true },
			{ name: 'cat_face', emoji: ':cat_face:', isCustomEmoji: true },
		];
		expect(searchEmojiNormalized('cat face', db).map(x => x.emoji)).toEqual([':cat_face:', ':blob:']);
	});

	test('余分なスペースは無視する', () => {
		expect(emojisOf('ねこ かお ')).toEqual([':cat_face:']);
	});
});

describe('shouldOpenEmojiSuggestion', () => {
	const closed: EmojiSuggestionState = { open: false };

	test('普通の検索語や空なら開く', () => {
		expect(shouldOpenEmojiSuggestion('', closed)).toBe(true);
		expect(shouldOpenEmojiSuggestion('neko', closed)).toBe(true);
		expect(shouldOpenEmojiSuggestion('ねこ', closed)).toBe(true);
	});

	test('候補が 0 件でも、スペースを含まなければ開いたまま', () => {
		expect(shouldOpenEmojiSuggestion('nekox', { open: true, lastSearch: { query: 'neko', count: 0 } })).toBe(true);
	});

	test('開いているなら、スペース 1 つで区切った検索語でも開いたまま', () => {
		const open: EmojiSuggestionState = { open: true, lastSearch: { query: 'neko', count: 3 } };
		expect(shouldOpenEmojiSuggestion('neko ', open)).toBe(true);
		expect(shouldOpenEmojiSuggestion('neko inu', { open: true, lastSearch: { query: 'neko in', count: 0 } })).toBe(true);
	});

	test('閉じているときは、スペースを含む検索語で開き直さない', () => {
		expect(shouldOpenEmojiSuggestion('neko inu', closed)).toBe(false);
		expect(shouldOpenEmojiSuggestion('30 の会議', closed)).toBe(false);
	});

	test('コロンの直後がスペースなら開かない', () => {
		expect(shouldOpenEmojiSuggestion(' neko', closed)).toBe(false);
		expect(shouldOpenEmojiSuggestion(' ', closed)).toBe(false);
		expect(shouldOpenEmojiSuggestion('\u3000', closed)).toBe(false);
	});

	test('スペースが 2 つ続いたら閉じる (全角スペースを含む)', () => {
		const open: EmojiSuggestionState = { open: true, lastSearch: { query: 'neko ', count: 3 } };
		expect(shouldOpenEmojiSuggestion('neko  ', open)).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko  inu', open)).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko\u3000\u3000', open)).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko \u3000', open)).toBe(false);
	});

	test('候補が 0 件の語のあとにスペースを打ったら閉じる', () => {
		expect(shouldOpenEmojiSuggestion('30 ', { open: true, lastSearch: { query: '30', count: 0 } })).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko xyz\u3000', { open: true, lastSearch: { query: 'neko xyz', count: 0 } })).toBe(false);
	});

	test('候補がある語のあとのスペースでは閉じない', () => {
		expect(shouldOpenEmojiSuggestion('neko\u3000', { open: true, lastSearch: { query: 'neko', count: 3 } })).toBe(true);
	});

	test('スペースを含む検索語で、IME の変換を確定した結果が 0 件なら閉じる', () => {
		expect(shouldOpenEmojiSuggestion('30 の', { open: true, lastSearch: { query: '30 の', count: 0 }, committed: true })).toBe(false);
		expect(shouldOpenEmojiSuggestion('neko かお', { open: true, lastSearch: { query: 'neko かお', count: 2 }, committed: true })).toBe(true);
		// 確定した検索語をまだ検索していなければ閉じない
		expect(shouldOpenEmojiSuggestion('neko かお', { open: true, lastSearch: { query: 'neko かw', count: 0 }, committed: true })).toBe(true);
		// スペースを含まなければ、確定して 0 件でも閉じない
		expect(shouldOpenEmojiSuggestion('ねこx', { open: true, lastSearch: { query: 'ねこx', count: 0 }, committed: true })).toBe(true);
	});

	test('IME で変換中は、0 件の語のあとのスペースでも閉じない', () => {
		expect(shouldOpenEmojiSuggestion('30 ', { open: true, lastSearch: { query: '30', count: 0 }, composing: true })).toBe(true);
	});

	test('最後に検索した語が直前の語でなければ (まだ検索していないなど)、スペースで閉じない', () => {
		expect(shouldOpenEmojiSuggestion('neko ', { open: true, lastSearch: { query: 'nek', count: 0 } })).toBe(true);
		expect(shouldOpenEmojiSuggestion('neko ', { open: true, lastSearch: null })).toBe(true);
	});
});

describe('shouldOpenEmojiSuggestion を入力の流れで使う', () => {
	const emojiDb: EmojiDef[] = [
		{ name: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'かわいい', aliasOf: 'neko', emoji: ':neko:', isCustomEmoji: true },
		{ name: 'inu', emoji: ':inu:', isCustomEmoji: true },
		{ name: 'star_30', emoji: ':star_30:', isCustomEmoji: true },
	];

	// committed: IME の変換を確定した (compositionend)
	type Step = { query: string; composing?: boolean; committed?: boolean };

	// autocomplete.ts と MkAutocomplete.vue の動きをまねる。開いている間だけ検索し、その件数を次の判定に使う
	function run(steps: Step[]): { open: boolean; count: number | null }[] {
		let state: EmojiSuggestionState = { open: false };
		return steps.map(({ query, composing, committed }) => {
			const open = shouldOpenEmojiSuggestion(query, { ...state, composing, committed });
			if (!open) {
				state = { open: false };
				return { open, count: null };
			}
			const count = searchEmojiNormalized(query, emojiDb).length;
			state = { open: true, lastSearch: { query, count } };
			return { open, count };
		});
	}

	test('ASCII の語・スペースのあと、IME の変換途中で 0 件になっても閉じず、語がそろうと候補が出る', () => {
		const result = run([
			{ query: 'n' },
			{ query: 'neko' },
			{ query: 'neko ' },
			{ query: 'neko k', composing: true },
			{ query: 'neko か', composing: true },
			{ query: 'neko かw', composing: true },
			{ query: 'neko かわ', composing: true },
			{ query: 'neko かわいい', composing: true },
			{ query: 'neko 可愛い', composing: true },
			{ query: 'neko かわいい', composing: true },
			// 確定したので compositionend で判定し直す
			{ query: 'neko かわいい', committed: true },
		]);
		expect(result.map(x => x.open)).toEqual(Array(11).fill(true));
		expect(result[5].count).toBe(0);
		expect(result[7].count).toBe(1);
		expect(result[10].count).toBe(1);
	});

	test('全角スペースで区切っても同じように続けて検索できる', () => {
		const result = run([
			{ query: 'neko' },
			{ query: 'neko\u3000' },
			{ query: 'neko\u3000か', composing: true },
			{ query: 'neko\u3000かわいい', composing: true },
			{ query: 'neko\u3000かわいい', committed: true },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, true, true, true]);
		expect(result[4].count).toBe(1);
	});

	test('`12:31 の会議` は、`31` が何にも当たらなければスペースを打った時点で閉じ、そのあと開き直さない', () => {
		const result = run([
			{ query: '3' },
			{ query: '31' },
			{ query: '31 ' },
			{ query: '31 の', composing: true },
			{ query: '31 の', committed: true },
			{ query: '31 の会議' },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, false, false, false, false]);
	});

	test('`12:30 の会議` は、`30` に当たる絵文字があっても、「の」を確定した時点で閉じる', () => {
		const result = run([
			{ query: '3' },
			{ query: '30' },
			{ query: '30 ' },
			{ query: '30 の', composing: true },
			{ query: '30 の', committed: true },
			{ query: '30 の会議', composing: true },
			{ query: '30 の会議', committed: true },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, true, true, false, false, false]);
	});

	test('確定した語が何にも当たらなければ閉じる', () => {
		const result = run([
			{ query: 'neko' },
			{ query: 'neko ' },
			{ query: 'neko かw', composing: true },
			{ query: 'neko かw', committed: true },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, true, false]);
	});

	test('スペースを 2 つ続けたら閉じ、続けて打っても開き直さない', () => {
		const result = run([
			{ query: 'neko' },
			{ query: 'neko ' },
			{ query: 'neko  ' },
			{ query: 'neko  i' },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, false, false]);
	});

	test('AND 検索の途中の語が 0 件でも閉じず、0 件のままスペースを打ったら閉じる', () => {
		const result = run([
			{ query: 'neko' },
			{ query: 'neko ' },
			{ query: 'neko x' },
			{ query: 'neko xy' },
			{ query: 'neko xy ' },
		]);
		expect(result.map(x => x.open)).toEqual([true, true, true, true, false]);
	});
});
