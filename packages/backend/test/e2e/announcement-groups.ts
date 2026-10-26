/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { beforeAll, describe, test } from 'vitest';
import { api, castAsError, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('お知らせのグループ', () => {
	let admin: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;

	beforeAll(async () => {
		admin = await signup({ username: 'admin' });
		alice = await signup({ username: 'alice' });
	});

	const createGroup = async (name: string, order = 0) => {
		const res = await api('admin/announcements/groups/create', { name, icon: 'ti-speakerphone', order }, admin);
		assert.strictEqual(res.status, 200);
		return res.body;
	};

	const createAnnouncement = async (params: Partial<misskey.Endpoints['admin/announcements/create']['req']> = {}) => {
		const res = await api('admin/announcements/create', {
			title: 'Title',
			text: 'Text',
			imageUrl: null,
			...params,
		}, admin);
		assert.strictEqual(res.status, 200);
		return res.body;
	};

	const unreadIds = async (user: misskey.entities.SignupResponse) => {
		const res = await api('i', {}, user);
		assert.strictEqual(res.status, 200);
		return res.body.unreadAnnouncements.map(x => x.id);
	};

	describe('管理の API', () => {
		test('作成・一覧・変更・削除ができ、モデレーションログに残る', async () => {
			const created = await createGroup('重要なお知らせ', 0);
			assert.strictEqual(created.name, '重要なお知らせ');
			assert.strictEqual(created.icon, 'ti-speakerphone');
			assert.strictEqual(created.order, 0);

			const list = await api('admin/announcements/groups/list', {}, admin);
			assert.strictEqual(list.status, 200);
			assert.ok(list.body.some(x => x.id === created.id));

			const update = await api('admin/announcements/groups/update', { id: created.id, name: '大事なお知らせ', icon: null, order: 5 }, admin);
			assert.strictEqual(update.status, 200);
			assert.strictEqual(update.body.name, '大事なお知らせ');
			assert.strictEqual(update.body.icon, null);
			assert.strictEqual(update.body.order, 5);

			const del = await api('admin/announcements/groups/delete', { id: created.id }, admin);
			assert.strictEqual(del.status, 204);

			const listAfter = await api('admin/announcements/groups/list', {}, admin);
			assert.strictEqual(listAfter.body.some(x => x.id === created.id), false);

			const logs = await api('admin/show-moderation-logs', { limit: 10 }, admin);
			const types = logs.body.map(x => x.type);
			assert.ok(types.includes('createAnnouncementGroup'));
			assert.ok(types.includes('updateAnnouncementGroup'));
			assert.ok(types.includes('deleteAnnouncementGroup'));
		});

		test('一般の利用者は管理の API を使えない', async () => {
			const res = await api('admin/announcements/groups/create', { name: 'x' }, alice);
			assert.strictEqual(res.status, 403);
		});

		test('存在しないグループの変更・削除はエラーになる', async () => {
			const update = await api('admin/announcements/groups/update', { id: '000000000000000000000000', name: 'x' }, admin);
			assert.strictEqual(update.status, 400);
			assert.strictEqual(castAsError(update.body as any).error.code, 'NO_SUCH_GROUP');

			const del = await api('admin/announcements/groups/delete', { id: '000000000000000000000000' }, admin);
			assert.strictEqual(del.status, 400);
			assert.strictEqual(castAsError(del.body as any).error.code, 'NO_SUCH_GROUP');
		});

		test('利用者向けの一覧は並び順で返り、ログインなしでも読める', async () => {
			const b = await createGroup('B', 20);
			const a = await createGroup('A', 10);

			const res = await api('announcements/groups', {});
			assert.strictEqual(res.status, 200);
			const ids = res.body.map(x => x.id);
			assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id));
		});
	});

	describe('お知らせの groupId', () => {
		test('作成・変更で groupId を指定でき、一覧で絞り込める', async () => {
			const group = await createGroup('ユーザーイベント');
			const inGroup = await createAnnouncement({ title: 'in group', groupId: group.id });
			const ungrouped = await createAnnouncement({ title: 'ungrouped' });

			const adminList = await api('admin/announcements/list', { groupId: group.id }, admin);
			assert.strictEqual(adminList.status, 200);
			assert.deepStrictEqual(adminList.body.map(x => x.id), [inGroup.id]);
			assert.strictEqual(adminList.body[0].groupId, group.id);

			const publicList = await api('announcements', { groupId: group.id }, alice);
			assert.deepStrictEqual(publicList.body.map(x => x.id), [inGroup.id]);
			assert.strictEqual(publicList.body[0].groupId, group.id);

			const ungroupedList = await api('announcements', { groupId: null, limit: 100 }, alice);
			assert.ok(ungroupedList.body.some(x => x.id === ungrouped.id));
			assert.strictEqual(ungroupedList.body.some(x => x.id === inGroup.id), false);

			const allList = await api('announcements', { limit: 100 }, alice);
			assert.ok(allList.body.some(x => x.id === ungrouped.id));
			assert.ok(allList.body.some(x => x.id === inGroup.id));

			const move = await api('admin/announcements/update', { id: ungrouped.id, groupId: group.id }, admin);
			assert.strictEqual(move.status, 204);
			const afterMove = await api('announcements', { groupId: group.id }, alice);
			assert.ok(afterMove.body.some(x => x.id === ungrouped.id));

			const unset = await api('admin/announcements/update', { id: ungrouped.id, groupId: null }, admin);
			assert.strictEqual(unset.status, 204);
			const afterUnset = await api('announcements', { groupId: group.id }, alice);
			assert.strictEqual(afterUnset.body.some(x => x.id === ungrouped.id), false);
		});

		test('存在しないグループは指定できない', async () => {
			const res = await api('admin/announcements/create', {
				title: 'x', text: 'x', imageUrl: null, groupId: '000000000000000000000000',
			}, admin);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_GROUP');
		});

		test('グループを消すと、そのお知らせは groupId が null になる', async () => {
			const group = await createGroup('消すグループ');
			const announcement = await createAnnouncement({ groupId: group.id });

			const del = await api('admin/announcements/groups/delete', { id: group.id }, admin);
			assert.strictEqual(del.status, 204);

			const show = await api('announcements/show', { announcementId: announcement.id }, alice);
			assert.strictEqual(show.status, 200);
			assert.strictEqual(show.body.groupId, null);
		});
	});

	describe('グループの非通知', () => {
		test('非通知のグループのお知らせは未読に数えない。既読の確認が必要なものと、自分宛てのものは数える', async () => {
			const bob = await signup({ username: 'bob' });
			const muted = await createGroup('非通知にするグループ');
			const other = await createGroup('通知するグループ');

			const update = await api('i/update', { mutedAnnouncementGroupIds: [muted.id] }, bob);
			assert.strictEqual(update.status, 200);
			assert.deepStrictEqual(update.body.mutedAnnouncementGroupIds, [muted.id]);

			const normalInMuted = await createAnnouncement({ title: 'normal in muted', groupId: muted.id });
			const confirmInMuted = await createAnnouncement({ title: 'confirm in muted', groupId: muted.id, needConfirmationToRead: true });
			const forBobInMuted = await createAnnouncement({ title: 'for bob in muted', groupId: muted.id, userId: bob.id });
			const inOther = await createAnnouncement({ title: 'in other', groupId: other.id });
			const ungrouped = await createAnnouncement({ title: 'ungrouped' });

			const ids = await unreadIds(bob);
			assert.strictEqual(ids.includes(normalInMuted.id), false);
			assert.ok(ids.includes(confirmInMuted.id));
			assert.ok(ids.includes(forBobInMuted.id));
			assert.ok(ids.includes(inOther.id));
			assert.ok(ids.includes(ungrouped.id));

			// 非通知でも、タブ (一覧) では読める
			const list = await api('announcements', { groupId: muted.id }, bob);
			assert.ok(list.body.some(x => x.id === normalInMuted.id));

			// 他の利用者には影響しない
			const aliceIds = await unreadIds(alice);
			assert.ok(aliceIds.includes(normalInMuted.id));
		});

		test('「その他」(グループなし) も非通知にできる', async () => {
			const carol = await signup({ username: 'carol' });
			const update = await api('i/update', { mutedAnnouncementGroupIds: ['ungrouped'] }, carol);
			assert.strictEqual(update.status, 200);

			const ungrouped = await createAnnouncement({ title: 'ungrouped for carol' });
			const ungroupedConfirm = await createAnnouncement({ title: 'ungrouped confirm', needConfirmationToRead: true });

			const ids = await unreadIds(carol);
			assert.strictEqual(ids.includes(ungrouped.id), false);
			assert.ok(ids.includes(ungroupedConfirm.id));
		});

		test('グループを消すと、利用者の非通知の設定からも外れる', async () => {
			const dave = await signup({ username: 'dave' });
			const group = await createGroup('消して外れるグループ');
			await api('i/update', { mutedAnnouncementGroupIds: [group.id, 'ungrouped'] }, dave);

			await api('admin/announcements/groups/delete', { id: group.id }, admin);

			const me = await api('i', {}, dave);
			assert.deepStrictEqual(me.body.mutedAnnouncementGroupIds, ['ungrouped']);
		});
	});
});
