/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Xev from 'xev';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

const ev = new Xev();

/**
 * 購読している間、ServerStatsService に「見ている」合図を送る間隔。
 * ServerStatsService は最後の合図から 5 分たつと収集を止めるので、それより十分短くする。
 */
const watchingHeartbeatInterval = 60 * 1000;

@Injectable({ scope: Scope.TRANSIENT })
export class ServerStatsChannel extends Channel {
	public readonly chName = 'serverStats';
	public static shouldShare = true;
	public static requireCredential = false as const;
	private heartbeatId: NodeJS.Timeout | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,
	) {
		super(request);
		//this.onStats = this.onStats.bind(this);
		//this.onMessage = this.onMessage.bind(this);
	}

	@bindThis
	public async init(params: JsonObject) {
		ev.addListener('serverStats', this.onStats);
		this.sendWatching();
		this.heartbeatId = setInterval(this.sendWatching, watchingHeartbeatInterval);
	}

	@bindThis
	private sendWatching() {
		// ServerStatsService が別のプロセスで動いていても届くよう、ev (cluster をまたぐ) で送る
		ev.emit('serverStatsWatching', null);
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
				ev.once(`serverStatsLog:${body.id}`, statsLog => {
					this.send('statsLog', statsLog);
				});
				ev.emit('requestServerStatsLog', {
					id: body.id,
					length: body.length,
				});
				break;
		}
	}

	@bindThis
	public dispose() {
		ev.removeListener('serverStats', this.onStats);
		if (this.heartbeatId) {
			clearInterval(this.heartbeatId);
			this.heartbeatId = null;
		}
	}
}
