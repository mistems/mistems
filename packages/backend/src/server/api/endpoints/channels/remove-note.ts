/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelFollowingsRepository, ChannelsRepository, NotesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['channels'],

	description: 'Remove a remote note that was collected into the channel by its hashtag. The note itself is not deleted.',

	requireCredential: true,

	kind: 'write:channels',

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '93065dc2-26e5-4beb-ad23-c2158631c5f6',
		},

		notInChannel: {
			message: 'The note is not in any channel.',
			code: 'NOT_IN_CHANNEL',
			id: 'd528e396-a10a-44dd-840b-e5f488ccf85b',
		},

		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '139b40e4-2f8c-4e5b-b371-b5ee3df192f9',
		},

		accessDenied: {
			message: 'You do not have edit privilege of the channel.',
			code: 'ACCESS_DENIED',
			id: '0764d21b-2fdf-4bc4-8dd1-b73643d7ed4b',
		},

		cannotRemoveLocalNote: {
			message: 'Only remote notes can be removed from the channel.',
			code: 'CANNOT_REMOVE_LOCAL_NOTE',
			id: 'e11e8051-7260-49fb-800d-bcabf1270335',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.channelFollowingsRepository)
		private channelFollowingsRepository: ChannelFollowingsRepository,

		private roleService: RoleService,
		private fanoutTimelineService: FanoutTimelineService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.notesRepository.findOneBy({ id: ps.noteId });
			if (note == null) throw new ApiError(meta.errors.noSuchNote);
			if (note.channelId == null) throw new ApiError(meta.errors.notInChannel);

			const channel = await this.channelsRepository.findOneBy({ id: note.channelId });
			if (channel == null) throw new ApiError(meta.errors.noSuchChannel);

			if (channel.userId !== me.id && !await this.roleService.isModerator(me)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			// ローカルのノートは、チャンネルから外すと連合しないチャンネルのノート (localOnly) が
			// ローカルタイムラインなどに出てしまうので、外せるのはリモートのノートだけにする
			if (note.userHost == null) throw new ApiError(meta.errors.cannotRemoveLocalNote);

			// ノートは消さず、チャンネルとのつながりだけを外す
			const result = await this.notesRepository.update({ id: note.id, channelId: channel.id }, { channelId: null });
			// 同時に外されて、ほかの処理が先に外していたときは、件数を二重に減らさない
			if (result.affected === 0) return;

			await this.channelsRepository.createQueryBuilder()
				.update()
				.set({ notesCount: () => '"notesCount" - 1' })
				.where('id = :id AND "notesCount" > 0', { id: channel.id })
				.execute();

			// Redis のチャンネルのタイムライン、ユーザーのチャンネルのノートの一覧、チャンネルをフォローしている人の
			// ホームタイムラインからも外す (ユーザーのふつうのタイムラインへは足さない。古いノートを足すと並びが崩れるため)
			const channelFollowings = await this.channelFollowingsRepository.find({
				where: { followeeId: channel.id },
				select: { followerId: true },
			});
			await Promise.all([
				this.fanoutTimelineService.remove(`channelTimeline:${channel.id}`, note.id),
				this.fanoutTimelineService.remove(`userTimelineWithChannel:${note.userId}`, note.id),
				...channelFollowings.flatMap(f => [
					this.fanoutTimelineService.remove(`homeTimeline:${f.followerId}`, note.id),
					this.fanoutTimelineService.remove(`homeTimelineWithFiles:${f.followerId}`, note.id),
				]),
			]);
		});
	}
}
