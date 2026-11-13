/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository, DriveFilesRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import { IdService } from '@/core/IdService.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { ChannelFederationHashtagService } from '@/core/ChannelFederationHashtagService.js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import {
	CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH,
	isChannelFederationHashtag,
	isValidChannelFederationHashtag,
} from '@/misc/channel-federation-hashtag.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['channels'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:channels',

	requiredRolePolicy: 'canCreateChannel',

	limit: {
		duration: ms('1hour'),
		max: 10,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Channel',
	},

	errors: {
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'cd1e9f3e-5a12-4ab4-96f6-5d0a2cc32050',
		},

		federationIncompatibleWithRenoteRestriction: {
			message: 'Federation cannot be enabled for a channel that disallows renote to external.',
			code: 'FEDERATION_INCOMPATIBLE_WITH_RENOTE_RESTRICTION',
			id: 'facd3448-c850-4473-ae3f-07770cc88305',
		},

		invalidFederationHashtag: {
			message: 'The federation hashtag can contain only letters, numbers and underscores.',
			code: 'INVALID_FEDERATION_HASHTAG',
			id: '024a7a60-b0ff-4b37-90b1-b30dc4622e0f',
		},

		federationHashtagTooLong: {
			message: 'The federation hashtag is too long.',
			code: 'FEDERATION_HASHTAG_TOO_LONG',
			id: 'a443107e-6b96-4fcb-bcf7-0d00bba7e07f',
		},

		federationHashtagMustContainMarker: {
			// 文言は WWW-Authenticate ヘッダーにも載るので、ASCII だけで書く (非 ASCII だと 500 になる)
			message: 'The federation hashtag must contain the marker that identifies a federated channel hashtag.',
			code: 'FEDERATION_HASHTAG_MUST_CONTAIN_MARKER',
			id: '14e85fc2-75f7-4d57-85a9-e32f9e658db5',
		},

		federationHashtagAlreadyUsed: {
			message: 'The federation hashtag is already used by another channel.',
			code: 'FEDERATION_HASHTAG_ALREADY_USED',
			id: 'f2042e9c-7bc6-41f2-b1f5-305cf7f6a9e6',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 128 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		bannerId: { type: 'string', format: 'misskey:id', nullable: true },
		color: { type: 'string', minLength: 1, maxLength: 16 },
		isSensitive: { type: 'boolean', nullable: true },
		allowRenoteToExternal: { type: 'boolean', nullable: true },
		federationPolicy: { type: 'string', nullable: true, enum: ['none', 'public', null] },
		// 連合するチャンネルのハッシュタグ (先頭の「#」はあってもなくてもよい)。省くとチャンネルの名前から作る。
		// 連合しない (federationPolicy が public でない) ときは無視する
		federationHashtag: { type: 'string', nullable: true, minLength: 1 },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		private idService: IdService,
		private channelEntityService: ChannelEntityService,
		private channelFederationHashtagService: ChannelFederationHashtagService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// チャンネル外リノート禁止と連合は両立しない (連合先ではリノート制約を強制できないため)
			if ((ps.federationPolicy ?? 'none') !== 'none' && ps.allowRenoteToExternal === false) {
				throw new ApiError(meta.errors.federationIncompatibleWithRenoteRestriction);
			}

			let banner = null;
			if (ps.bannerId != null) {
				banner = await this.driveFilesRepository.findOneBy({
					id: ps.bannerId,
					userId: me.id,
				});

				if (banner == null) {
					throw new ApiError(meta.errors.noSuchFile);
				}
			}

			const id = this.idService.gen();
			const federationPolicy = ps.federationPolicy ?? 'none';

			// ハッシュタグの指定があれば、使える文字・長さ・目印・重なりを調べる (channels/update と同じ規則)。
			// ほかのサーバーから届いたハッシュタグに合わせてチャンネルを作るときに使う
			let requestedHashtag: string | null = null;
			if (federationPolicy === 'public' && ps.federationHashtag != null) {
				requestedHashtag = ps.federationHashtag.replace(/^#/, '');
				if (Array.from(requestedHashtag).length > CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH) {
					throw new ApiError(meta.errors.federationHashtagTooLong);
				}
				if (!isValidChannelFederationHashtag(requestedHashtag)) {
					throw new ApiError(meta.errors.invalidFederationHashtag);
				}
				if (!isChannelFederationHashtag(requestedHashtag)) {
					throw new ApiError(meta.errors.federationHashtagMustContainMarker);
				}
				if (await this.channelFederationHashtagService.isTaken(normalizeTag(requestedHashtag), null)) {
					throw new ApiError(meta.errors.federationHashtagAlreadyUsed);
				}
			}

			// 連合するチャンネルは、作るときにハッシュタグを決めて保存する。
			// 生成と保存の間にほかのチャンネルが同じハッシュタグを取ったときは、一意のインデックスで弾かれるので作り直す。
			for (let attempt = 0; ; attempt++) {
				const federationHashtag = federationPolicy === 'public'
					? requestedHashtag ?? await this.channelFederationHashtagService.generate({ id, name: ps.name })
					: null;

				let channel: MiChannel;
				try {
					channel = await this.channelsRepository.insertOne({
						id,
						userId: me.id,
						name: ps.name,
						description: ps.description ?? null,
						bannerId: banner ? banner.id : null,
						isSensitive: ps.isSensitive ?? false,
						...(ps.color !== undefined ? { color: ps.color } : {}),
						allowRenoteToExternal: ps.allowRenoteToExternal ?? true,
						federationPolicy,
						federationHashtag,
						federationHashtagNormalized: federationHashtag != null ? normalizeTag(federationHashtag) : null,
					} as MiChannel);
				} catch (err) {
					// 指定されたハッシュタグは作り直せないので、重なったことをそのまま返す
					if (requestedHashtag != null && isDuplicateKeyValueError(err)) throw new ApiError(meta.errors.federationHashtagAlreadyUsed);
					if (federationHashtag != null && attempt < 3 && isDuplicateKeyValueError(err)) continue;
					throw err;
				}

				return await this.channelEntityService.pack(channel, me);
			}
		});
	}
}
