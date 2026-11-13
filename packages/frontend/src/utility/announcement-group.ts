/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { updateCurrentAccount } from '@/accounts.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 非通知の設定で「グループに入っていないお知らせ」を表す値 (backend と同じ) */
export const UNGROUPED_ANNOUNCEMENT_GROUP_ID = 'ungrouped';

export function isAnnouncementGroupMuted(groupId: string | null): boolean {
	if ($i == null) return false;
	return ($i.mutedAnnouncementGroupIds ?? []).includes(groupId ?? UNGROUPED_ANNOUNCEMENT_GROUP_ID);
}

/**
 * 自分にとって非通知のお知らせかどうか (silence と同じ扱いにする)
 * 既読の確認が必要なものと自分宛てのものは、非通知の対象にしない (backend と同じ判定)
 */
export function isAnnouncementMutedForMe(announcement: Pick<Misskey.entities.Announcement, 'groupId' | 'needConfirmationToRead' | 'forYou'>): boolean {
	if (announcement.needConfirmationToRead || announcement.forYou) return false;
	return isAnnouncementGroupMuted(announcement.groupId);
}

export async function setAnnouncementGroupMuted(groupId: string | null, muted: boolean): Promise<void> {
	if ($i == null) return;
	const key = groupId ?? UNGROUPED_ANNOUNCEMENT_GROUP_ID;
	const current = $i.mutedAnnouncementGroupIds ?? [];
	const next = muted ? [...new Set([...current, key])] : current.filter(x => x !== key);

	const res = await misskeyApi('i/update', { mutedAnnouncementGroupIds: next });
	updateCurrentAccount({
		mutedAnnouncementGroupIds: res.mutedAnnouncementGroupIds,
		unreadAnnouncements: res.unreadAnnouncements,
		hasUnreadAnnouncement: res.hasUnreadAnnouncement,
	});
}

/** グループのアイコン (例: ti-speakerphone、speakerphone) を表示用のクラスにする */
export function announcementGroupIconClass(icon: string | null | undefined, fallback = 'ti ti-point'): string {
	const name = (icon ?? '').trim().replace(/^ti\s+/, '');
	if (name === '') return fallback;
	return `ti ${name.startsWith('ti-') ? name : `ti-${name}`}`;
}
