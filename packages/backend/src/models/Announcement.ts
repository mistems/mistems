/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, Column, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiAnnouncementGroup } from './AnnouncementGroup.js';

@Entity('announcement')
export class MiAnnouncement {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone', {
		comment: 'The updated date of the Announcement.',
		nullable: true,
	})
	public updatedAt: Date | null;

	@Column('varchar', {
		length: 8192, nullable: false,
	})
	public text: string;

	@Column('varchar', {
		length: 256, nullable: false,
	})
	public title: string;

	@Column('varchar', {
		length: 1024, nullable: true,
	})
	public imageUrl: string | null;

	// info, warning, error, success
	@Column('varchar', {
		length: 256, nullable: false,
		default: 'info',
	})
	public icon: 'info' | 'warning' | 'error' | 'success';

	// normal ... お知らせページ掲載
	// banner ... お知らせページ掲載 + バナー表示
	// dialog ... お知らせページ掲載 + ダイアログ表示
	@Column('varchar', {
		length: 256, nullable: false,
		default: 'normal',
	})
	public display: 'normal' | 'banner' | 'dialog';

	@Column('boolean', {
		default: false,
	})
	public needConfirmationToRead: boolean;

	@Index()
	@Column('boolean', {
		default: true,
	})
	public isActive: boolean;

	@Column('timestamp with time zone', {
		comment: 'The date after which the Announcement is automatically archived.',
		nullable: true,
	})
	public autoArchiveAt: Date | null;

	@Index()
	@Column('boolean', {
		default: false,
	})
	public forExistingUsers: boolean;

	@Index()
	@Column('boolean', {
		default: false,
	})
	public silence: boolean;

	@Index()
	@Column({
		...id(),
		nullable: true,
	})
	public userId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column({
		...id(),
		nullable: true,
	})
	public groupId: MiAnnouncementGroup['id'] | null;

	@ManyToOne(() => MiAnnouncementGroup, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public group: MiAnnouncementGroup | null;

	// グループの中の表示順 (昇順。同じなら新しい順)
	@Column('integer', {
		default: 0,
	})
	public displayOrder: number;

	constructor(data: Partial<MiAnnouncement>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
