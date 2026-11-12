/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository, ChannelsRepository } from '@/models/_.js';
import { MiChannel } from '@/models/Channel.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['channels'],

	requireCredential: true,

	kind: 'write:channels',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Channel',
	},

	errors: {
		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: 'f9c5467f-d492-4c3c-9a8d-a70dacc86512',
		},

		accessDenied: {
			message: 'You do not have edit privilege of the channel.',
			code: 'ACCESS_DENIED',
			id: '1fb7cb09-d46a-4fdf-b8df-057788cce513',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'e86c14a4-0da2-4032-8df3-e737a04c7f3b',
		},

		federationIncompatibleWithRenoteRestriction: {
			message: 'Federation cannot be enabled for a channel that disallows renote to external.',
			code: 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION',
			id: '28f70990-cc45-4866-b4a2-73bf16d288b1',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 128 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		bannerId: { type: 'string', format: 'misskey:id', nullable: true },
		isArchived: { type: 'boolean', nullable: true },
		pinnedNoteIds: {
			type: 'array',
			items: {
				type: 'string', format: 'misskey:id',
			},
		},
		color: { type: 'string', minLength: 1, maxLength: 16 },
		isSensitive: { type: 'boolean', nullable: true },
		allowRenoteToExternal: { type: 'boolean', nullable: true },
		federationPolicy: { type: 'string', nullable: true, enum: ['none', 'home', 'public', null] },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private channelEntityService: ChannelEntityService,

		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			const iAmModerator = await this.roleService.isModerator(me);
			if (channel.userId !== me.id && !iAmModerator) {
				throw new ApiError(meta.errors.accessDenied);
			}

			// eslint:disable-next-line:no-unnecessary-initializer
			let banner = undefined;
			if (ps.bannerId != null) {
				banner = await this.driveFilesRepository.findOneBy({
					id: ps.bannerId,
					userId: me.id,
				});

				if (banner == null) {
					throw new ApiError(meta.errors.noSuchFile);
				}
			} else if (ps.bannerId === null) {
				banner = null;
			}

			// 「連合する × チャンネル外リノート禁止」の組み合わせを不変条件として守るため、
			// read → validate → update を悲観ロック付きトランザクションで行う (並行更新による貫通を防ぐ)。
			await this.channelsRepository.manager.transaction(async transactionalEntityManager => {
				const lockedChannel = await transactionalEntityManager.findOne(MiChannel, {
					where: { id: channel.id },
					lock: { mode: 'pessimistic_write' },
				});

				if (lockedChannel == null) {
					throw new ApiError(meta.errors.noSuchChannel);
				}

				const nextFederationPolicy = ps.federationPolicy ?? lockedChannel.federationPolicy;
				const nextAllowRenoteToExternal = typeof ps.allowRenoteToExternal === 'boolean' ? ps.allowRenoteToExternal : lockedChannel.allowRenoteToExternal;
				if (nextFederationPolicy !== 'none' && !nextAllowRenoteToExternal) {
					throw new ApiError(meta.errors.federationIncompatibleWithRenoteRestriction);
				}

				await transactionalEntityManager.update(MiChannel, lockedChannel.id, {
					...(ps.name !== undefined ? { name: ps.name } : {}),
					...(ps.description !== undefined ? { description: ps.description } : {}),
					...(ps.pinnedNoteIds !== undefined ? { pinnedNoteIds: ps.pinnedNoteIds } : {}),
					...(ps.color !== undefined ? { color: ps.color } : {}),
					...(typeof ps.isArchived === 'boolean' ? { isArchived: ps.isArchived } : {}),
					...(banner ? { bannerId: banner.id } : {}),
					...(typeof ps.isSensitive === 'boolean' ? { isSensitive: ps.isSensitive } : {}),
					...(typeof ps.allowRenoteToExternal === 'boolean' ? { allowRenoteToExternal: ps.allowRenoteToExternal } : {}),
					...(ps.federationPolicy !== undefined && ps.federationPolicy !== null ? { federationPolicy: ps.federationPolicy } : {}),
				});
			});

			return await this.channelEntityService.pack(channel.id, me);
		});
	}
}
