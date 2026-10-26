/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Brackets, EntityNotFoundError, IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiUser } from '@/models/User.js';
import { MiAnnouncement } from '@/models/_.js';
import type { AnnouncementReadsRepository, AnnouncementsRepository, MiAnnouncementRead, UsersRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { AnnouncementEntityService } from '@/core/entities/AnnouncementEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { QueueService } from '@/core/QueueService.js';
import { UNGROUPED_ANNOUNCEMENT_GROUP_ID } from '@/core/AnnouncementGroupService.js';

@Injectable()
export class AnnouncementService implements OnModuleInit {
	constructor(
		@Inject(DI.announcementsRepository)
		private announcementsRepository: AnnouncementsRepository,

		@Inject(DI.announcementReadsRepository)
		private announcementReadsRepository: AnnouncementReadsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private moderationLogService: ModerationLogService,
		private announcementEntityService: AnnouncementEntityService,
		private queueService: QueueService,
	) {
	}

	@bindThis
	public async onModuleInit(): Promise<void> {
		// Redisのデータ消失・再構築などでジョブが失われた場合にも予約を復元する
		const announcements = await this.announcementsRepository.findBy({
			isActive: true,
			autoArchiveAt: Not(IsNull()),
		});

		await Promise.all(announcements.map(announcement =>
			this.queueService.scheduleAnnouncementArchive(announcement.id, announcement.autoArchiveAt!),
		));
	}

	@bindThis
	public async getReads(userId: MiUser['id']): Promise<MiAnnouncementRead[]> {
		return this.announcementReadsRepository.findBy({
			userId: userId,
		});
	}

	@bindThis
	public async getUnreadAnnouncements(user: MiUser): Promise<MiAnnouncement[]> {
		const now = new Date();
		const readsQuery = this.announcementReadsRepository.createQueryBuilder('read')
			.select('read.announcementId')
			.where('read.userId = :userId', { userId: user.id });

		const q = this.announcementsRepository.createQueryBuilder('announcement')
			.where('announcement.isActive = true')
			.andWhere(new Brackets(qb => {
				qb.where('announcement.autoArchiveAt IS NULL');
				qb.orWhere('announcement.autoArchiveAt > :now', { now });
			}))
			.andWhere('announcement.silence = false')
			// 利用者が非通知にしたグループのお知らせは数えない。
			// ただし、既読の確認が必要なものと特定の利用者向けのものは、確実に届けるため非通知の対象にしない
			.andWhere(new Brackets(qb => {
				qb.orWhere('announcement.needConfirmationToRead = true');
				qb.orWhere('announcement.userId IS NOT NULL');
				qb.orWhere(`NOT (COALESCE(announcement.groupId, :ungroupedId) = ANY(COALESCE((SELECT "mutedAnnouncementGroupIds" FROM "user_profile" WHERE "userId" = :userId), '{}')))`, { ungroupedId: UNGROUPED_ANNOUNCEMENT_GROUP_ID });
			}))
			.andWhere(new Brackets(qb => {
				qb.orWhere('announcement.userId = :userId', { userId: user.id });
				qb.orWhere('announcement.userId IS NULL');
			}))
			.andWhere(new Brackets(qb => {
				qb.orWhere('announcement.forExistingUsers = false');
				qb.orWhere('announcement.id > :userId', { userId: user.id });
			}))
			.andWhere(`announcement.id NOT IN (${ readsQuery.getQuery() })`);

		q.setParameters(readsQuery.getParameters());

		return q.getMany();
	}

	/**
	 * グループ (null はグループなし) の先頭に置くための表示順を返す
	 */
	@bindThis
	private async getHeadDisplayOrder(groupId: MiAnnouncement['groupId']): Promise<number> {
		const query = this.announcementsRepository.createQueryBuilder('announcement')
			.select('MIN(announcement.displayOrder)', 'min')
			.where('announcement.userId IS NULL');

		if (groupId == null) {
			query.andWhere('announcement.groupId IS NULL');
		} else {
			query.andWhere('announcement.groupId = :groupId', { groupId });
		}

		const result = await query.getRawOne<{ min: number | null }>();
		return result?.min == null ? 0 : result.min - 1;
	}

	@bindThis
	public async create(values: Partial<MiAnnouncement>, moderator?: MiUser): Promise<{ raw: MiAnnouncement; packed: Packed<'Announcement'> }> {
		// 新しいお知らせはグループの先頭に置く
		const displayOrder = values.userId ? 0 : await this.getHeadDisplayOrder(values.groupId ?? null);

		const announcement = await this.announcementsRepository.insertOne({
			id: this.idService.gen(),
			updatedAt: null,
			title: values.title,
			text: values.text,
			imageUrl: values.imageUrl || null,
			icon: values.icon,
			display: values.display,
			forExistingUsers: values.forExistingUsers,
			silence: values.silence,
			needConfirmationToRead: values.needConfirmationToRead,
			userId: values.userId,
			autoArchiveAt: values.autoArchiveAt ?? null,
			groupId: values.groupId ?? null,
			displayOrder,
			isActive: values.isActive ?? (values.autoArchiveAt == null || values.autoArchiveAt > new Date()),
		});

		const packed = await this.announcementEntityService.pack(announcement);

		if (announcement.isActive && announcement.autoArchiveAt != null) {
			await this.queueService.scheduleAnnouncementArchive(announcement.id, announcement.autoArchiveAt);
		}

		// 作成処理中にautoArchiveAtを過ぎる可能性があるため、insert完了時点で非アクティブなお知らせはイベント配信しない
		if (values.userId) {
			if (announcement.isActive) {
				this.globalEventService.publishMainStream(values.userId, 'announcementCreated', {
					announcement: packed,
				});
			}

			if (moderator) {
				const user = await this.usersRepository.findOneByOrFail({ id: values.userId });
				this.moderationLogService.log(moderator, 'createUserAnnouncement', {
					announcementId: announcement.id,
					announcement: announcement,
					userId: values.userId,
					userUsername: user.username,
					userHost: user.host,
				});
			}
		} else {
			if (announcement.isActive) {
				this.globalEventService.publishBroadcastStream('announcementCreated', {
					announcement: packed,
				});
			}

			if (moderator) {
				this.moderationLogService.log(moderator, 'createGlobalAnnouncement', {
					announcementId: announcement.id,
					announcement: announcement,
				});
			}
		}

		return {
			raw: announcement,
			packed: packed,
		};
	}

	@bindThis
	public async update(announcement: MiAnnouncement, values: Partial<MiAnnouncement>, moderator?: MiUser): Promise<void> {
		// 別のグループへ移したお知らせは、移った先のグループの先頭に置く
		const displayOrder = values.groupId !== undefined && values.groupId !== announcement.groupId && announcement.userId == null
			? await this.getHeadDisplayOrder(values.groupId)
			: undefined;

		// レプリカから古い値を読まないよう、更新後の値はRETURNINGで取得する
		const after: MiAnnouncement | undefined = await this.announcementsRepository.createQueryBuilder().update()
			.set({
				updatedAt: new Date(),
				title: values.title,
				text: values.text,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				imageUrl: values.imageUrl || null,
				display: values.display,
				icon: values.icon,
				forExistingUsers: values.forExistingUsers,
				silence: values.silence,
				needConfirmationToRead: values.needConfirmationToRead,
				isActive: values.isActive,
				autoArchiveAt: values.autoArchiveAt,
				groupId: values.groupId,
				displayOrder,
			})
			.where('id = :id', { id: announcement.id })
			.returning('*')
			.execute()
			.then((response) => response.raw[0]);

		if (after == null) {
			throw new EntityNotFoundError(this.announcementsRepository.metadata.target, { id: announcement.id });
		}

		if (announcement.autoArchiveAt?.getTime() !== after.autoArchiveAt?.getTime() || announcement.isActive !== after.isActive) {
			if (announcement.autoArchiveAt != null) {
				await this.queueService.clearAnnouncementArchive(announcement.id, announcement.autoArchiveAt);
			}

			if (after.isActive && after.autoArchiveAt != null) {
				await this.queueService.scheduleAnnouncementArchive(after.id, after.autoArchiveAt);
			}
		}

		if (moderator) {
			if (announcement.userId) {
				const user = await this.usersRepository.findOneByOrFail({ id: announcement.userId });
				this.moderationLogService.log(moderator, 'updateUserAnnouncement', {
					announcementId: announcement.id,
					before: announcement,
					after: after,
					userId: announcement.userId,
					userUsername: user.username,
					userHost: user.host,
				});
			} else {
				this.moderationLogService.log(moderator, 'updateGlobalAnnouncement', {
					announcementId: announcement.id,
					before: announcement,
					after: after,
				});
			}
		}
	}

	/**
	 * グループ (null はグループなし) の中のお知らせを、渡した順に並べ替える
	 */
	@bindThis
	public async reorder(groupId: MiAnnouncement['groupId'], announcementIds: MiAnnouncement['id'][], moderator?: MiUser): Promise<void> {
		await this.announcementsRepository.manager.transaction(async (em) => {
			for (const [i, id] of announcementIds.entries()) {
				await em.update(MiAnnouncement, { id, groupId: groupId ?? IsNull(), userId: IsNull() }, { displayOrder: i });
			}
		});

		if (moderator) {
			this.moderationLogService.log(moderator, 'reorderAnnouncements', {
				groupId,
				announcementIds,
			});
		}
	}

	@bindThis
	public async archiveAnnouncement(announcementId: MiAnnouncement['id'], autoArchiveAt: Date): Promise<boolean> {
		const now = new Date();

		// 日時も照合し、日時変更前に予約された古いジョブがお知らせをアーカイブしないようにする
		const result = await this.announcementsRepository.createQueryBuilder()
			.update()
			.set({
				isActive: false,
				updatedAt: now,
			})
			.where('id = :announcementId', { announcementId })
			.andWhere('isActive = true')
			.andWhere('autoArchiveAt = :autoArchiveAt', { autoArchiveAt })
			.andWhere('autoArchiveAt <= :now', { now })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	@bindThis
	public async delete(announcement: MiAnnouncement, moderator?: MiUser): Promise<void> {
		await this.announcementsRepository.delete(announcement.id);

		if (announcement.autoArchiveAt != null) {
			await this.queueService.clearAnnouncementArchive(announcement.id, announcement.autoArchiveAt);
		}

		if (moderator) {
			if (announcement.userId) {
				const user = await this.usersRepository.findOneByOrFail({ id: announcement.userId });
				this.moderationLogService.log(moderator, 'deleteUserAnnouncement', {
					announcementId: announcement.id,
					announcement: announcement,
					userId: announcement.userId,
					userUsername: user.username,
					userHost: user.host,
				});
			} else {
				this.moderationLogService.log(moderator, 'deleteGlobalAnnouncement', {
					announcementId: announcement.id,
					announcement: announcement,
				});
			}
		}
	}

	@bindThis
	public async getAnnouncement(announcementId: MiAnnouncement['id'], me: MiUser | null): Promise<Packed<'Announcement'>> {
		const announcement = await this.announcementsRepository.findOneByOrFail({ id: announcementId });

		if (announcement.userId && (me == null || announcement.userId !== me.id)) {
			throw new EntityNotFoundError(this.announcementsRepository.metadata.target, { id: announcementId });
		}

		if (me) {
			const read = await this.announcementReadsRepository.findOneBy({
				announcementId: announcement.id,
				userId: me.id,
			});
			return this.announcementEntityService.pack({ ...announcement, isRead: read !== null }, me);
		} else {
			return this.announcementEntityService.pack(announcement, null);
		}
	}

	@bindThis
	public async read(user: MiUser, announcementId: MiAnnouncement['id']): Promise<void> {
		try {
			await this.announcementReadsRepository.insert({
				id: this.idService.gen(),
				announcementId: announcementId,
				userId: user.id,
			});
		} catch (_) {
			return;
		}

		const announcement = await this.announcementsRepository.findOneBy({ id: announcementId });
		if (announcement != null && announcement.userId === user.id) {
			await this.announcementsRepository.update(announcementId, {
				isActive: false,
			});
		}

		if ((await this.getUnreadAnnouncements(user)).length === 0) {
			this.globalEventService.publishMainStream(user.id, 'readAllAnnouncements');
		}
	}
}
