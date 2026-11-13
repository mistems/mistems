/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as mfm from 'mfm-js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';

/**
 * 連合するチャンネルのハッシュタグに必ず入る目印。
 * トレンドの集計から外す判定と、持ち主が付け替えるときの検査に使う。
 * normalizeTag (NFKC + 小文字化) で形が変わらない文字だけでできている。
 */
export const CHANNEL_FEDERATION_HASHTAG_MARKER = '連合チャンネル_';

/** Misskey のハッシュタグの上限 (models/Hashtag.ts の name と同じ 128 文字。コードポイントで数える) */
export const CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH = 128;

/** チャンネル名が使えない文字だけだったときに代わりに使う、チャンネルの ID の末尾の長さ */
const CHANNEL_ID_FALLBACK_LENGTH = 6;

/**
 * 文字・数字・下線 (Unicode の \p{L} \p{N} _) 以外を取り除く。
 * Mastodon などでハッシュタグが途中で切れないよう、記号・空白・「.」などをすべて落とす。
 */
export function sanitizeChannelFederationHashtagPart(s: string): string {
	return s.replace(/[^\p{L}\p{N}_]/gu, '');
}

/** 連合するチャンネルのハッシュタグとして使える文字列か (先頭の「#」は含めない) */
export function isValidChannelFederationHashtag(tag: string): boolean {
	const length = Array.from(tag).length;
	return length > 0 && length <= CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH && /^[\p{L}\p{N}_]+$/u.test(tag);
}

/** ハッシュタグ (正規化の前後どちらでもよい) が、連合するチャンネルの形をしているか */
export function isChannelFederationHashtag(tag: string): boolean {
	return normalizeTag(tag).includes(CHANNEL_FEDERATION_HASHTAG_MARKER);
}

function truncate(s: string, length: number): string {
	return Array.from(s).slice(0, Math.max(0, length)).join('');
}

/**
 * 連合するチャンネルのハッシュタグの候補を作る (先頭の「#」は含めない)。
 * 形は `連合チャンネル_{チャンネル名}{suffix}` で、全体を 128 文字以内に収める。
 * サーバー名を入れないので、ほかのサーバーの同じ名前の連合するチャンネルと同じハッシュタグになり、
 * 互いのノートを収蔵しあえる。
 *
 * - チャンネル名: チャンネル名から使えない文字を取り除いたもの。空ならチャンネルの ID の末尾 6 文字
 * - suffix: このサーバーのほかのチャンネルと重なったときに付ける `_2`、`_3` など
 */
export function buildChannelFederationHashtag(params: {
	channelName: string;
	channelId: string;
	suffix?: number;
}): string {
	let channel = sanitizeChannelFederationHashtagPart(params.channelName);
	if (channel === '') channel = sanitizeChannelFederationHashtagPart(params.channelId).slice(-CHANNEL_ID_FALLBACK_LENGTH);

	const suffix = params.suffix != null && params.suffix > 1 ? `_${params.suffix}` : '';
	const fixedLength = Array.from(CHANNEL_FEDERATION_HASHTAG_MARKER).length + Array.from(suffix).length;
	channel = truncate(channel, CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH - fixedLength);

	return `${CHANNEL_FEDERATION_HASHTAG_MARKER}${channel}${suffix}`;
}

/**
 * ノートの本文 (MFM) から、連合するチャンネルの形をしたハッシュタグを取り出す。
 * 古い MISTEMS は、チャンネルのハッシュタグを AP の tag に入れず本文の付記にだけ書いていたので、
 * 受け取る側は AP の tag に加えて本文からも読む。
 */
export function extractChannelFederationHashtagsFromText(text: string | null | undefined): string[] {
	if (text == null || !text.includes(CHANNEL_FEDERATION_HASHTAG_MARKER)) return [];
	return extractHashtags(mfm.parse(text)).filter(tag => isChannelFederationHashtag(tag));
}
