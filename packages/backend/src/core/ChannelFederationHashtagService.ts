/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, Not } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository } from '@/models/_.js';
import { MiChannel } from '@/models/Channel.js';
import { bindThis } from '@/decorators.js';
import { normalizeTag } from '@/misc/normalize-tag.js';
import { buildChannelFederationHashtag } from '@/misc/channel-federation-hashtag.js';

/** 重なりを避けて `_2`、`_3`… を試す上限 */
const MAX_SUFFIX = 1000;

@Injectable()
export class ChannelFederationHashtagService {
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
	) {
	}

	/**
	 * 正規化したハッシュタグが、ほかのチャンネルで使われているか。
	 */
	@bindThis
	public async isTaken(normalized: string, exceptChannelId: MiChannel['id'] | null, em?: EntityManager): Promise<boolean> {
		const repository = em ? em.getRepository(MiChannel) : this.channelsRepository;
		return await repository.exists({
			where: {
				federationHashtagNormalized: normalized,
				...(exceptChannelId != null ? { id: Not(exceptChannelId) } : {}),
			},
		});
	}

	/**
	 * チャンネルの名前から、このサーバーのほかのチャンネルと重ならないハッシュタグを作る (保存はしない)。
	 */
	@bindThis
	public async generate(channel: Pick<MiChannel, 'id' | 'name'>, em?: EntityManager): Promise<string> {
		for (let suffix = 1; suffix <= MAX_SUFFIX; suffix++) {
			const candidate = buildChannelFederationHashtag({
				channelName: channel.name,
				channelId: channel.id,
				suffix,
			});
			if (!await this.isTaken(normalizeTag(candidate), channel.id, em)) return candidate;
		}

		// ここまで重なることはまずないが、念のためチャンネルの ID で区別する
		return buildChannelFederationHashtag({
			channelName: channel.id,
			channelId: channel.id,
		});
	}

	/**
	 * 外から届いたノートのハッシュタグのうち、どれかに一致する連合するチャンネル (アーカイブされていないもの) を返す。
	 * 複数に一致したときは、ノートのハッシュタグの並びで先に出たものを選ぶ。
	 */
	@bindThis
	public async findCollectingChannel(tags: string[]): Promise<MiChannel | null> {
		const normalizedTags = [...new Set(tags.map(tag => normalizeTag(tag)))];
		if (normalizedTags.length === 0) return null;

		const channels = await this.channelsRepository.findBy({
			federationHashtagNormalized: In(normalizedTags),
			federationPolicy: 'public',
			isArchived: false,
		});
		if (channels.length === 0) return null;

		for (const tag of normalizedTags) {
			const channel = channels.find(c => c.federationHashtagNormalized === tag);
			if (channel) return channel;
		}
		return null;
	}
}
