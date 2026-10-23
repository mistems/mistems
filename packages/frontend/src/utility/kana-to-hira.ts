/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MISTEMS: 絵文字検索ひらカナ大統一
// 絵文字の検索では、検索語と比べられる側 (名前・エイリアス・Unicode 絵文字の索引のキーワード) の両方に
// normalizeForEmojiSearch をかけてから比べる。片側だけをそろえると、大文字やカタカナを含む側に当たらなくなる。
// データ自体は変えず、比べるときだけかける。
// NOTE: custom-emojis.ts にも toKanaToHira と同じ変換がある。party/17758-emoji-cache との統合
//       (rerere の解消方法) を崩さないため、今は共通化していない。

import { searchEmoji } from '@/utility/search-emoji.js';
import type { EmojiDef } from '@/utility/search-emoji.js';

export function toKanaToHira(str: string): string {
	return str.replace(/[ァ-ヶ]/g, (match) => {
		const chr = match.charCodeAt(0) - 0x60;
		return String.fromCharCode(chr);
	});
}

// Unicode 絵文字の索引のキーワードは 1 言語で約 9 千件あり、入力のたびに正規化し直すのは無駄なのでキャッシュする
const NORMALIZE_CACHE_LIMIT = 100_000;
const normalizeCache = new Map<string, string>();

/**
 * 絵文字の検索で比べるための形にそろえる。
 * NFKC で全角英数・全角記号を半角に、半角カナを全角カナに、分けて書いた濁点を 1 文字にしたうえで、
 * 小文字にし、カタカナをひらがなにする。
 */
export function normalizeForEmojiSearch(str: string): string {
	const cached = normalizeCache.get(str);
	if (cached != null) return cached;

	const normalized = toKanaToHira(str.normalize('NFKC').toLowerCase());
	if (normalizeCache.size >= NORMALIZE_CACHE_LIMIT) normalizeCache.clear();
	normalizeCache.set(str, normalized);
	return normalized;
}

// 名前を正規化した検索用の一覧。元の一覧ごとに作り、正規化した項目から元の項目へ引き戻せるようにしておく
const normalizedDbCache = new WeakMap<EmojiDef[], EmojiDef[]>();
const originalOf = new WeakMap<EmojiDef, EmojiDef>();

function getNormalizedEmojiDb(emojiDb: EmojiDef[]): EmojiDef[] {
	const cached = normalizedDbCache.get(emojiDb);
	if (cached) return cached;

	const normalized = emojiDb.map(x => {
		const y = { ...x, name: normalizeForEmojiSearch(x.name) };
		originalOf.set(y, x);
		return y;
	});
	normalizedDbCache.set(emojiDb, normalized);
	return normalized;
}

/**
 * スペースで区切った語のすべてを含む絵文字を返す (AND 検索)。
 * 絵文字ごと (同じ emoji を持つ項目) に名前とエイリアスを集め、各語がそのどれかに含まれればよい。
 * 並びは元の一覧の順で、エイリアスでない項目を代表にする。
 */
function searchEmojiAnd(keywords: string[], normalizedDb: EmojiDef[], max: number): EmojiDef[] {
	const groups = new Map<string, { representative: EmojiDef; names: string[] }>();
	for (const x of normalizedDb) {
		const key = x.emoji;
		const group = groups.get(key);
		if (group == null) {
			groups.set(key, { representative: x, names: [x.name] });
		} else {
			group.names.push(x.name);
			if (group.representative.aliasOf != null && x.aliasOf == null) group.representative = x;
		}
	}

	const results: EmojiDef[] = [];
	for (const { representative, names } of groups.values()) {
		if (keywords.every(keyword => names.some(name => name.includes(keyword)))) {
			results.push(representative);
			if (results.length >= max) break;
		}
	}
	return results;
}

/**
 * searchEmoji を、大文字・小文字、ひらがな・カタカナ、全角・半角を区別せずに引く。
 * 検索語にスペースがあれば、区切った語のすべてを含む絵文字に絞る (AND 検索)。
 * 返る項目は元の (正規化していない) 一覧の項目である。
 */
export function searchEmojiNormalized(query: string | null, emojiDb: EmojiDef[], max = 30): EmojiDef[] {
	if (!query) return [];

	const normalizedQuery = normalizeForEmojiSearch(query);
	const normalizedDb = getNormalizedEmojiDb(emojiDb);
	const keywords = normalizedQuery.split(' ').filter(keyword => keyword !== '');
	const results = keywords.length >= 2
		? searchEmojiAnd(keywords, normalizedDb, max)
		: searchEmoji(keywords[0] ?? normalizedQuery, normalizedDb, max);
	return results.map(x => originalOf.get(x) ?? x);
}

/**
 * 入力補助 (`:` に続けて打った文字列) で、絵文字の候補を開いておくかどうか。
 * スペースで区切って AND 検索できるよう、スペース 1 つでは閉じない。
 * `:` の直後がスペースのとき (`注意: …` など普通の文章) は開かず、スペースが 2 つ続いたら閉じる。
 */
export function shouldOpenEmojiSuggestion(query: string): boolean {
	return !query.startsWith(' ') && !query.includes('  ');
}
