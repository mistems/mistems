/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { AnnouncementGroupsRepository, MiAnnouncementGroup, MiUser, UserProfilesRepository } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

/**
 * 利用者の非通知の設定で「グループに入っていないお知らせ」を表す値
 */
export const UNGROUPED_ANNOUNCEMENT_GROUP_ID = 'ungrouped';

@Injectable()
export class AnnouncementGroupService {
	constructor(
		@Inject(DI.announcementGroupsRepository)
		private announcementGroupsRepository: AnnouncementGroupsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private idService: IdService,
		private moderationLogService: ModerationLogService,
	) {
	}

	@bindThis
	public pack(group: MiAnnouncementGroup): Packed<'AnnouncementGroup'> {
		return {
			id: group.id,
			createdAt: this.idService.parse(group.id).date.toISOString(),
			updatedAt: group.updatedAt?.toISOString() ?? null,
			name: group.name,
			icon: group.icon,
			order: group.order,
		};
	}

	@bindThis
	public async list(): Promise<MiAnnouncementGroup[]> {
		return this.announcementGroupsRepository.find({
			order: { order: 'ASC', id: 'ASC' },
		});
	}

	@bindThis
	public async exists(id: MiAnnouncementGroup['id']): Promise<boolean> {
		return this.announcementGroupsRepository.existsBy({ id });
	}

	@bindThis
	public async create(values: Pick<MiAnnouncementGroup, 'name' | 'icon' | 'order'>, moderator: MiUser): Promise<MiAnnouncementGroup> {
		const group = await this.announcementGroupsRepository.insertOne({
			id: this.idService.gen(),
			updatedAt: null,
			name: values.name,
			icon: values.icon,
			order: values.order,
		});

		this.moderationLogService.log(moderator, 'createAnnouncementGroup', {
			groupId: group.id,
			group: group,
		});

		return group;
	}

	@bindThis
	public async update(group: MiAnnouncementGroup, values: Partial<Pick<MiAnnouncementGroup, 'name' | 'icon' | 'order'>>, moderator: MiUser): Promise<MiAnnouncementGroup> {
		await this.announcementGroupsRepository.update(group.id, {
			updatedAt: new Date(),
			name: values.name,
			icon: values.icon,
			order: values.order,
		});

		const after = await this.announcementGroupsRepository.findOneByOrFail({ id: group.id });

		this.moderationLogService.log(moderator, 'updateAnnouncementGroup', {
			groupId: group.id,
			before: group,
			after: after,
		});

		return after;
	}

	@bindThis
	public async delete(group: MiAnnouncementGroup, moderator: MiUser): Promise<void> {
		// お知らせの groupId は外部キーの ON DELETE SET NULL で null に戻る
		await this.announcementGroupsRepository.delete(group.id);

		// 利用者の非通知の設定からも外す
		await this.userProfilesRepository.createQueryBuilder()
			.update()
			.set({
				mutedAnnouncementGroupIds: () => 'array_remove("mutedAnnouncementGroupIds", :groupId)',
			})
			.where(':groupId = ANY("mutedAnnouncementGroupIds")')
			.setParameters({ groupId: group.id })
			.execute();

		this.moderationLogService.log(moderator, 'deleteAnnouncementGroup', {
			groupId: group.id,
			group: group,
		});
	}
}
