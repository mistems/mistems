/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * チャンネルが連合する設定かどうか。
 * backend の NoteCreateService.doesChannelFederate と同じ allow-list 方式 (未知の値は連合しない側に倒す)
 * にして、将来 federationPolicy に値を足したときに backend/frontend で判定がズレないようにする。
 */
export function isFederatedChannel(channel: { federationPolicy?: 'none' | 'home' | 'public' } | null | undefined): boolean {
	return channel?.federationPolicy === 'home' || channel?.federationPolicy === 'public';
}
