/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// サーバー側 (UtilityService.isKeyWordIncluded) と同じ判定をクライアントで再現する。
// バックエンドは RE2 を使うが、クライアントでは ReDoS の影響が自分のタブに限られるため
// ネイティブの RegExp で代替する。
//
// RE2 と JS RegExp の表現力の差について:
// - RE2 にあって JS では使えない後方参照 `\1` / 先読み `(?=)` / 後読み `(?<=)` は、
//   そもそも RE2 側の正規表現として書けないので考慮不要。
// - フラグで吸収できる差 (大文字小文字 i / 複数行 m / dotall s、および RE2 は常に
//   Unicode 対応なので u) は buildRegExpFromRe2() で対応する。
// - フラグでは吸収できない、RE2 にあって JS (ES2025 時点) でも書けない構文
//   (POSIX クラス `[[:alpha:]]` / `\A` `\z` / `(?P<name>)` / `\C` / `\x{...}` /
//    ungreedy フラグ U / コロン無し `(?i)` 等) は再現できない。これらを含むフィルタは
//   RegExp の構築に失敗し、マッチ無し扱い (= 警告もハイライトも出さない安全側) になる。
//   詳細は buildRegExpFromRe2() のコメント参照。

export type SensitiveWordRange = {
	start: number;
	end: number;
};

const regexpLike = /^\/(.+)\/(.*)$/;

/**
 * RE2 のフラグのうち JS の RegExp と対応が取れるものだけを移植する。
 * - i / m / s: JS と同義なのでそのまま通す
 * - g: matchAll に必須なので常に付与する
 * - U (ungreedy): JS に対応するフラグが無いため再現不可。落とす (貪欲/非貪欲の意味が
 *   RE2 と逆になるが、構築自体を失敗させずマッチ有無の判定は概ね保つことを優先する)
 * - それ以外の未知フラグも、JS が受け付けず RegExp 構築が例外になるため落とす
 */
function mapRe2FlagsToJs(re2Flags: string): string {
	let flags = 'g';
	for (const f of ['i', 'm', 's']) {
		if (re2Flags.includes(f)) flags += f;
	}
	return flags;
}

/**
 * RE2 構文の正規表現を JS の RegExp に変換する。構築できなければ null を返す。
 *
 * RE2 にあって JS (ES2025 時点) には無く、ここでは再現できない表現:
 * - POSIX 文字クラス `[[:alpha:]]` など
 * - テキスト先頭/末尾アンカー `\A` `\z`
 * - Python 形式の名前付きグループ `(?P<name>...)` (JS は `(?<name>...)` のみ)
 * - 任意 1 バイト `\C`
 * - 波括弧 16 進エスケープ `\x{...}` (JS は u フラグ + `\u{...}`)
 * - ungreedy フラグ `(?U)` / `/.../U`、コロン無しインラインフラグ `(?i)`
 * これらを含むパターンは構築に失敗し、null (= 警告を出さない) になる。
 */
function buildRegExpFromRe2(source: string, re2Flags: string): RegExp | null {
	const flags = mapRe2FlagsToJs(re2Flags);
	// RE2 は Unicode 対応がデフォルト。u フラグ付きを優先し (`.` や文字クラスをコードポイント
	// 単位で扱い `\p{...}` を有効化)、u 非互換なパターンは u 無しにフォールバックする。
	for (const candidate of [flags + 'u', flags]) {
		try {
			return new RegExp(source, candidate);
		} catch {
			// 次の候補を試す
		}
	}
	return null;
}

function pushAllOccurrences(ranges: SensitiveWordRange[], text: string, word: string): void {
	if (word === '') return;
	let idx = text.indexOf(word);
	while (idx !== -1) {
		ranges.push({ start: idx, end: idx + word.length });
		idx = text.indexOf(word, idx + word.length);
	}
}

function mergeRanges(ranges: SensitiveWordRange[]): SensitiveWordRange[] {
	if (ranges.length <= 1) return ranges;
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: SensitiveWordRange[] = [{ ...sorted[0] }];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		const cur = sorted[i];
		if (cur.start <= last.end) {
			last.end = Math.max(last.end, cur.end);
		} else {
			merged.push({ ...cur });
		}
	}
	return merged;
}

/**
 * テキストに含まれるセンシティブワードを検出する。
 * @returns ranges: ハイライト用にマージ済みの位置情報 / matched: マッチしたフィルタ文字列の一覧
 */
export function detectSensitiveWords(text: string, keyWords: string[]): {
	ranges: SensitiveWordRange[];
	matched: string[];
} {
	if (keyWords.length === 0 || text === '') return { ranges: [], matched: [] };

	const ranges: SensitiveWordRange[] = [];
	const matched: string[] = [];

	for (const filter of keyWords) {
		if (filter === '') continue;
		const regexp = filter.match(regexpLike);
		if (!regexp) {
			// スペース区切りの全単語 AND マッチ
			const words = filter.split(' ').filter(w => w !== '');
			if (words.length === 0) continue;
			if (words.every(w => text.includes(w))) {
				matched.push(filter);
				for (const w of words) {
					pushAllOccurrences(ranges, text, w);
				}
			}
		} else {
			// /pattern/flags 形式。サーバーは RE2 で評価するが、クライアントでは RegExp で代替する。
			const re = buildRegExpFromRe2(regexp[1], regexp[2]);
			if (re == null) continue; // RE2 専用構文などで構築できないものはスキップ (= 安全側)
			let hit = false;
			for (const m of text.matchAll(re)) {
				if (m[0].length === 0) continue; // 0 文字マッチは無限ループ防止のため除外
				hit = true;
				ranges.push({ start: m.index, end: m.index + m[0].length });
			}
			if (hit) matched.push(filter);
		}
	}

	return { ranges: mergeRanges(ranges), matched };
}

const HIGHLIGHT_PREFIX = '$[bg.color=ffff00 $[fg.color=000000 ';
const HIGHLIGHT_SUFFIX = ']]';

/**
 * 指定範囲を MFM の `$[bg]` / `$[fg]` でラップし、黄背景・黒文字で表示できるようにする。
 * MFM パース前に文字列を加工するため、レンダリング後のオフセットずれが起きない。
 * ただしマッチ範囲が既存トークン (URL / 絵文字 / 既存 `$[...]`) を分断する場合や
 * マッチ文字列に `]` 等を含む場合は MFM が崩れうる (ベストエフォート)。
 */
export function annotateSensitiveWords(text: string, ranges: SensitiveWordRange[]): string {
	if (ranges.length === 0) return text;
	// インデックスを保つため後方から適用する (ranges は昇順ソート済み前提)
	let result = text;
	for (let i = ranges.length - 1; i >= 0; i--) {
		const { start, end } = ranges[i];
		result = result.slice(0, start) + HIGHLIGHT_PREFIX + result.slice(start, end) + HIGHLIGHT_SUFFIX + result.slice(end);
	}
	return result;
}

/**
 * テキスト中のセンシティブワードを MFM ハイライト付き文字列に変換する。
 */
export function highlightSensitiveWords(text: string, keyWords: string[]): string {
	return annotateSensitiveWords(text, detectSensitiveWords(text, keyWords).ranges);
}
