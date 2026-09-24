/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { misskeyApi } from '@/utility/misskey-api.js';

export type Keys =
	'channelsLastReadedAt'; // チャンネル既読時刻 (channelId → epoch ms)。localStorage とサーバーの registry の両方に保持する

export const miRegistryItem = {
	async get(key: Keys) {
		try {
			return JSON.parse(await misskeyApi('i/registry/get', { scope: ['client'], key }));
		} catch (err: any) {
			if (err.code === 'NO_SUCH_KEY') return {};
			throw err;
		}
	},
	async set(key: Keys, payload: unknown) {
		await misskeyApi('i/registry/set', { scope: ['client'], key, value: JSON.stringify(payload) });
	},
};
