/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { emojiRegex } from '@/misc/emoji-regex.js';

/**
 * 公開 API (`notes/show` / `notes/reactions` / `emoji`) が Misskey と互換のソフトウェア。
 * `instance.softwareName` (小文字) と突き合わせる。
 */
export const MISSKEY_COMPATIBLE_SOFTWARE: readonly string[] = [
	'misskey',
	'sharkey',
	'cherrypick',
	'firefish',
	'iceshrimp',
	'foundkey',
];

/** 相手のリアクションのキーの数の既定の上限 */
export const REMOTE_REACTION_MAX_KEYS = 256;

/** 1 つのキーの数の上限 (相手の値をそのまま信じすぎないため) */
const REMOTE_REACTION_MAX_COUNT = 1_000_000;

// ReactionService の decodeCustomEmojiRegexp と同じ形 (`:name:` / `:name@host:` / `:name@.:`)
const customEmojiReactionRegexp = /^:([\w+-]+)(?:@([\w.-]+))?:$/;
const singleUnicodeEmojiRegexp = new RegExp(`^${emojiRegex.source}$`);

export function isMisskeyCompatibleSoftware(softwareName: string | null | undefined): boolean {
	if (softwareName == null) return false;
	return MISSKEY_COMPATIBLE_SOFTWARE.includes(softwareName.toLowerCase());
}

/**
 * `https://<host>/notes/<id>` の形の URI から、相手のサーバーでのノートの id を取り出す。
 * ホストが違う、または形が違うときは null を返す。
 */
export function parseMisskeyNoteUri(uri: string, host: string): string | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	if (url.host.toLowerCase() !== host.toLowerCase()) return null;
	if (url.search !== '' || url.hash !== '') return null;
	const match = url.pathname.match(/^\/notes\/([a-zA-Z0-9]+)$/);
	return match ? match[1] : null;
}

export type RemoteReactionEmoji = {
	name: string;
	host: string;
	/** 相手のサーバー自身の絵文字 (`:name@.:`) だったか。`reactionEmojis` に URL が入らないので別に取る */
	isRemoteLocal: boolean;
};

export type MappedRemoteReaction = {
	/** 自分のサーバーの `note.reactions` でのキー */
	key: string;
	/** 自分のサーバーにリモート絵文字として必要なもの (Unicode や自分の絵文字なら null) */
	emoji: RemoteReactionEmoji | null;
};

/**
 * 相手の `reactions` のキーを、自分のサーバーの `note.reactions` のキーに変える。
 *
 * | 相手のキー | 自分のキー |
 * | --- | --- |
 * | Unicode の絵文字 | そのまま |
 * | `:name@.:` | `:name@<相手のホスト>:` |
 * | `:name@other.host:` | そのまま |
 * | `:name@<自分のホスト>:` | `:name:` (自分の絵文字の DB 上の形。表示時に `:name@.:` になる) |
 *
 * 不正なキーは null を返す。
 */
export function mapRemoteReactionKey(key: string, remoteHost: string, localHost: string): MappedRemoteReaction | null {
	const custom = key.match(customEmojiReactionRegexp);
	if (custom) {
		const name = custom[1];
		const host = custom[2]?.toLowerCase() ?? '.';
		if (host === '.' || host === remoteHost.toLowerCase()) {
			return { key: `:${name}@${remoteHost}:`, emoji: { name, host: remoteHost, isRemoteLocal: true } };
		}
		if (host === localHost.toLowerCase()) {
			return { key: `:${name}:`, emoji: null };
		}
		return { key: `:${name}@${host}:`, emoji: { name, host, isRemoteLocal: false } };
	}

	if (singleUnicodeEmojiRegexp.test(key)) {
		return { key, emoji: null };
	}

	return null;
}

/**
 * 相手の `reactions` を検証し、キーを自分のサーバーの形に変える。
 * 数が正の整数でないもの、不正なキーは捨てる。
 */
export function mapRemoteReactions(
	remote: unknown,
	remoteHost: string,
	localHost: string,
	opts?: { maxKeys?: number },
): { reactions: Record<string, number>; emojis: RemoteReactionEmoji[] } {
	const reactions: Record<string, number> = {};
	const emojis: RemoteReactionEmoji[] = [];
	if (remote == null || typeof remote !== 'object' || Array.isArray(remote)) return { reactions, emojis };

	const maxKeys = opts?.maxKeys ?? REMOTE_REACTION_MAX_KEYS;
	const seenEmojis = new Set<string>();

	for (const [rawKey, rawCount] of Object.entries(remote)) {
		if (Object.keys(reactions).length >= maxKeys) break;
		if (typeof rawCount !== 'number' || !Number.isInteger(rawCount) || rawCount <= 0) continue;
		const mapped = mapRemoteReactionKey(rawKey, remoteHost, localHost);
		if (mapped == null) continue;

		const count = Math.min(rawCount, REMOTE_REACTION_MAX_COUNT);
		reactions[mapped.key] = (reactions[mapped.key] ?? 0) + count;

		if (mapped.emoji != null) {
			const id = `${mapped.emoji.name}@${mapped.emoji.host}`;
			if (!seenEmojis.has(id)) {
				seenEmojis.add(id);
				emojis.push(mapped.emoji);
			}
		}
	}

	return { reactions, emojis };
}

/**
 * 自分のサーバーの数と相手の数を、キーごとに max を取って合わせる。
 * 自分のサーバーにしか無いキーは残す。`changed` は値が増えるキーだけを返す。
 */
export function mergeRemoteReactions(
	local: Record<string, number>,
	remote: Record<string, number>,
): { merged: Record<string, number>; changed: Record<string, number> } {
	const changed: Record<string, number> = {};
	for (const [key, count] of Object.entries(remote)) {
		if (count > (local[key] ?? 0)) changed[key] = count;
	}
	return { merged: { ...local, ...changed }, changed };
}

/**
 * `note.reactions` (DB) の目標の数を決める。キーごとに max(相手の数, note_reaction の行の数) を取り、
 * まだ DB に書き込まれていないバッファの差分を引く (後で書き込まれる分を二重に数えないため)。
 */
export function computeTargetReactionCounts(
	remote: Record<string, number>,
	rows: Record<string, number>,
	bufferedDeltas: Record<string, number> = {},
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const key of new Set([...Object.keys(remote), ...Object.keys(rows)])) {
		const target = Math.max(remote[key] ?? 0, rows[key] ?? 0) - (bufferedDeltas[key] ?? 0);
		if (target > 0) result[key] = target;
	}
	return result;
}

/**
 * 相手の `notes/reactions` の `type` を、`ReactionService.create` に渡すリアクションに変える。
 * Like を受け取ったときと同じく、付けたユーザーのホストの絵文字は `:name:` で渡す
 * (`ReactionService.create` が、付けたユーザーのホストの絵文字として引く)。
 * それ以外のカスタム絵文字は変換後のキーのまま渡す (`create` の中で `❤` に置き換わる)。
 * 不正なときは null を返す。
 */
export function toReactionForCreate(type: string, remoteHost: string, localHost: string, reacterHost: string): string | null {
	const mapped = mapRemoteReactionKey(type, remoteHost, localHost);
	if (mapped == null) return null;
	if (mapped.emoji != null && mapped.emoji.host === reacterHost.toLowerCase()) return `:${mapped.emoji.name}:`;
	return mapped.key;
}
