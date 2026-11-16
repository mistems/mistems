/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { DI } from '@/di-symbols.js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import { CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH, isChannelFederationHashtag } from '@/misc/channel-federation-hashtag.js';
import { ApiError } from '../../error.js';

/**
 * 連合するチャンネルのハッシュタグ (`#連合チャンネル_…`) を持つ、このサーバーのチャンネルを返す。
 * ハッシュタグのページで、チャンネルを作る案内の代わりに、すでにあるチャンネルへ誘導するのに使う。
 *
 * ハッシュタグはチャンネルをまたいで重ならないので、一致するのは多くても 1 つ。
 * アーカイブ済みや、連合をやめた (none に戻した) チャンネルもハッシュタグを持ち続け、同じハッシュタグで新しく作れないので返す。
 */
export const meta = {
	tags: ['channels'],

	requireCredential: false,

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Channel',
	},

	errors: {
		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '64242230-3623-49b0-a0f5-dbe9228e9e70',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		// 先頭の「#」はあってもなくてもよい
		federationHashtag: { type: 'string', minLength: 1, maxLength: CHANNEL_FEDERATION_HASHTAG_MAX_LENGTH + 1 },
	},
	required: ['federationHashtag'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		private channelEntityService: ChannelEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const tag = ps.federationHashtag.replace(/^#/, '');
			if (!isChannelFederationHashtag(tag)) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			const channel = await this.channelsRepository.findOneBy({
				federationHashtagNormalized: normalizeTag(tag),
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			return await this.channelEntityService.pack(channel, me);
		});
	}
}
