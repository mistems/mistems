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
});
