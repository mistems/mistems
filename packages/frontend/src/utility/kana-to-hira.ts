/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MISTEMS: 絵文字検索ひらカナ大統一
// custom-emojis.ts はカスタム絵文字のエイリアスをひらがな・小文字にそろえて保持する。
// 検索語の側もそろえないと、カタカナの検索語がエイリアスに当たらなくなるので、検索の入口ではここを通す。
// NOTE: custom-emojis.ts と MkEmojiPicker.vue にも同じ変換がある。party/17758-emoji-cache との統合
//       (rerere の解消方法) を崩さないため、今は共通化していない。

import { searchEmoji } from '@/utility/search-emoji.js';
import type { EmojiDef } from '@/utility/search-emoji.js';

export function toKanaToHira(str: string): string {
	return str.replace(/[ァ-ヶ]/g, (match) => {
		const chr = match.charCodeAt(0) - 0x60;
		return String.fromCharCode(chr);
	});
}

/**
 * searchEmoji を、ひらがな・カタカナを区別せずに引く。
 * 元の検索語の結果を先に並べ、検索語をひらがな・小文字にそろえた語の結果を後に足す (重複は除く)。
 * 元の検索語でも引くのは、Unicode 絵文字の名前など、カタカナのまま残る項目にも当てるため。
 */
export function searchEmojiKanaInsensitive(query: string | null, emojiDb: EmojiDef[], max = 30): EmojiDef[] {
	const results = searchEmoji(query, emojiDb, max);
	if (query == null) return results;

	const normalizedQuery = toKanaToHira(query.toLowerCase());
	if (normalizedQuery === query) return results;

	const seen = new Set(results.map(x => x.emoji));
	for (const x of searchEmoji(normalizedQuery, emojiDb, max)) {
		if (results.length >= max) break;
		if (seen.has(x.emoji)) continue;
		seen.add(x.emoji);
		results.push(x);
	}
	return results;
}
