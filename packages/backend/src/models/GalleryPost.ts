/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import type { MiDriveFile } from './DriveFile.js';

@Entity('gallery_post')
export class MiGalleryPost {
	@PrimaryColumn(id())
	public id: string;

	// Index dropped by migration 1794546098079 (unused in production; see the plan 2026-11-12-使われていないインデックスの整理.md).
	@Column('timestamp with time zone', {
		comment: 'The updated date of the GalleryPost.',
	})
	public updatedAt: Date;

	@Column('varchar', {
		length: 256,
	})
	public title: string;

	@Column('varchar', {
		length: 2048, nullable: true,
	})
	public description: string | null;

	@Index()
	@Column({
		...id(),
		comment: 'The ID of author.',
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	// Index dropped by migration 1794546098079 (unused in production; see the plan 2026-11-12-使われていないインデックスの整理.md).
	@Column({
		...id(),
		array: true, default: '{}',
	})
	public fileIds: MiDriveFile['id'][];

	// Index dropped by migration 1794546098079 (unused in production; see the plan 2026-11-12-使われていないインデックスの整理.md).
	@Column('boolean', {
		default: false,
		comment: 'Whether the post is sensitive.',
	})
	public isSensitive: boolean;

	@Index()
	@Column('integer', {
		default: 0,
	})
	public likedCount: number;

	// Index dropped by migration 1794546098079 (unused in production; see the plan 2026-11-12-使われていないインデックスの整理.md).
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public tags: string[];

	constructor(data: Partial<MiGalleryPost>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
