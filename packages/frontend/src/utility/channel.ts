/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * チャンネルが連合する設定かどうか。
 * backend の NoteCreateService.doesChannelFederate と同じ allow-list 方式 (未知の値は連合しない側に倒す)
 * にして、将来 federationPolicy に値を足したときに backend/frontend で判定がズレないようにする。
 */
export function isFederatedChannel(channel: { federationPolicy?: 'none' | 'public' } | null | undefined): boolean {
	return channel?.federationPolicy === 'public';
}

/**
 * 連合するチャンネルのハッシュタグに必ず入る目印。
 * backend の misc/channel-federation-hashtag.ts の CHANNEL_FEDERATION_HASHTAG_MARKER と同じ値にする。
 */
export const CHANNEL_FEDERATION_HASHTAG_MARKER = '連合チャンネル_';

/** ハッシュタグ (先頭の「#」はあってもなくてもよい) が、連合するチャンネルの形をしているか */
export function isChannelFederationHashtag(tag: string): boolean {
	return tag.normalize('NFKC').toLowerCase().includes(CHANNEL_FEDERATION_HASHTAG_MARKER);
}

/**
 * 連合するチャンネルのハッシュタグから、チャンネルの名前の候補を作る (目印より後ろの部分)。
 * 目印より後ろが空なら、ハッシュタグをそのまま返す。
 */
export function channelNameFromFederationHashtag(tag: string): string {
	const bare = tag.replace(/^#/, '');
	const index = bare.indexOf(CHANNEL_FEDERATION_HASHTAG_MARKER);
	if (index === -1) return bare;
	const name = bare.slice(index + CHANNEL_FEDERATION_HASHTAG_MARKER.length);
	return name === '' ? bare : name;
}
