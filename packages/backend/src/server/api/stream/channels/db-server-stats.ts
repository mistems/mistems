/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Xev from 'xev';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import { RoleService } from '@/core/RoleService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

const ev = new Xev();

@Injectable({ scope: Scope.TRANSIENT })
export class DbServerStatsChannel extends Channel {
	public readonly chName = 'dbServerStats';
	public static shouldShare = true;
	public static requireCredential = true as const;
	public static kind = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private roleService: RoleService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (!this.user) return false;
		// DB 内部状態は攻撃の手がかりになり得るのでモデレーター以上に限定
		if (!await this.roleService.isModerator(this.user)) return false;

		ev.addListener('dbServerStats', this.onStats);
		return true;
	}

	@bindThis
	private onStats(stats: JsonObject) {
		this.send('stats', stats);
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		switch (type) {
			case 'requestLog':
				if (!isJsonObject(body)) return;
				if (typeof body.id !== 'string' && typeof body.id !== 'number') return;
				if (typeof body.length !== 'number') return;
				ev.once(`dbServerStatsLog:${body.id}`, statsLog => {
					this.send('statsLog', statsLog);
				});
				ev.emit('requestDbServerStatsLog', {
					id: body.id,
					length: body.length,
				});
				break;
		}
	}

	@bindThis
	public dispose() {
		ev.removeListener('dbServerStats', this.onStats);
	}
}
