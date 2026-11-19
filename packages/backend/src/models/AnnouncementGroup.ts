/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

@Entity('announcement_group')
export class MiAnnouncementGroup {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone', {
		comment: 'The updated date of the AnnouncementGroup.',
		nullable: true,
	})
	public updatedAt: Date | null;

	@Column('varchar', {
		length: 256, nullable: false,
	})
	public name: string;

	// tabler icons のクラス名 (例: ti-speakerphone)
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public icon: string | null;

	@Column('integer', {
		default: 0,
	})
	public order: number;

	constructor(data: Partial<MiAnnouncementGroup>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
