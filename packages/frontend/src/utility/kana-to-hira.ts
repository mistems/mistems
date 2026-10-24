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

type EmojiGroup = { representative: EmojiDef; names: string[] };

// 正規化した一覧ごとに、絵文字 (同じ emoji を持つ項目) ごとのまとまりをキャッシュする
const emojiGroupsCache = new WeakMap<EmojiDef[], EmojiGroup[]>();

function getEmojiGroups(normalizedDb: EmojiDef[]): EmojiGroup[] {
	const cached = emojiGroupsCache.get(normalizedDb);
	if (cached) return cached;

	const groups = new Map<string, EmojiGroup>();
	for (const x of normalizedDb) {
		const group = groups.get(x.emoji);
		if (group == null) {
			groups.set(x.emoji, { representative: x, names: [x.name] });
		} else {
			group.names.push(x.name);
			if (group.representative.aliasOf != null && x.aliasOf == null) group.representative = x;
		}
	}
	const result = Array.from(groups.values());
	emojiGroupsCache.set(normalizedDb, result);
	return result;
}

/**
 * スペースで区切った語のすべてを含む絵文字を返す (AND 検索)。
 * 絵文字ピッカーの AND 検索と同じく、名前だけで全部の語に当たる絵文字を先に、
 * 名前とエイリアスのどれかで各語に当たる絵文字を後に並べる (それぞれ元の一覧の順)。代表はエイリアスでない項目。
 */
function searchEmojiAnd(keywords: string[], normalizedDb: EmojiDef[], max: number): EmojiDef[] {
	const groups = getEmojiGroups(normalizedDb);
	const results: EmojiDef[] = [];
	const added = new Set<EmojiGroup>();

	const passes: ((group: EmojiGroup) => boolean)[] = [
		group => group.representative.aliasOf == null && keywords.every(keyword => group.representative.name.includes(keyword)),
		group => keywords.every(keyword => group.names.some(name => name.includes(keyword))),
	];
	for (const pass of passes) {
		for (const group of groups) {
			if (results.length >= max) return results;
			if (added.has(group) || !pass(group)) continue;
			added.add(group);
			results.push(group.representative);
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

// 入力補助の検索語を区切るスペース。半角・全角のどちらでもよい
const EMOJI_QUERY_SEPARATOR = /[ \u3000]/;
const EMOJI_QUERY_DOUBLE_SEPARATOR = /[ \u3000]{2}/;

export type EmojiSuggestionState = {
	/** 絵文字の候補をすでに開いているか (候補が 0 件で一覧を出していないときも含む) */
	open: boolean;
	/** 開いている候補で最後に検索した検索語と、その候補の件数。まだ検索していなければ null */
	lastSearch?: { query: string; count: number } | null;
	/** IME で変換中か */
	composing?: boolean;
	/** IME の変換を確定した直後の判定か */
	committed?: boolean;
};

/**
 * 入力補助 (`:` に続けて打った文字列) で、絵文字の候補を開いておくかどうか。
 * スペース (半角・全角) で区切って AND 検索できるよう、スペース 1 つでは閉じない。
 * 候補が 0 件になっても閉じずに、一覧を出さないまま検索を続ける (IME の変換途中の `neko かw` などで閉じないように)。
 *
 * 次のときは開かない・閉じる。
 * - `:` の直後がスペースのとき (`注意: …` など普通の文章)
 * - スペースが 2 つ続いたとき
 * - 閉じている状態で、スペースを含む検索語になったとき (一度閉じたら開き直さない)
 * - 候補が 0 件の語のあとにスペースを打ったとき (`12:30 の会議` など、絵文字を探していない文章とみなす)。IME で変換中は判定しない
 * - スペースを含む検索語で、IME の変換を確定した結果が 0 件のとき (確定した語が何にも当たらない = 普通の文章とみなす)
 */
export function shouldOpenEmojiSuggestion(query: string, state: EmojiSuggestionState): boolean {
	if (query !== '' && EMOJI_QUERY_SEPARATOR.test(query[0])) return false;
	if (EMOJI_QUERY_DOUBLE_SEPARATOR.test(query)) return false;
	if (!EMOJI_QUERY_SEPARATOR.test(query)) return true;
	if (!state.open) return false;

	const last = state.lastSearch;
	if (state.committed && last != null && last.query === query && last.count === 0) return false;
	const endsWithSeparator = EMOJI_QUERY_SEPARATOR.test(query.at(-1) ?? '');
	if (!state.composing && endsWithSeparator && last != null && last.query === query.slice(0, -1) && last.count === 0) return false;
	return true;
}
