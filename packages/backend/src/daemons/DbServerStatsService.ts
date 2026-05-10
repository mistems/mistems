/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Xev from 'xev';
import { bindThis } from '@/decorators.js';
import { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import type { OnApplicationShutdown } from '@nestjs/common';

const ev = new Xev();

const interval = 60 * 1000;
const logCapacity = 200;

export type DbServerStats = {
	ts: string;
	hostId: string;
	cpu: number | null;
	memUsed: number | null;
	memTotal: number | null;
	diskUsed: number | null;
	diskTotal: number | null;
	diskRSec: number | null;
	diskWSec: number | null;
	dbSize: number | null;
	connActive: number | null;
	connMax: number | null;
	cacheHitRatio: number | null;
};

type Row = {
	ts: Date;
	host_id: string;
	cpu: number | null;
	mem_used: string | null;
	mem_total: string | null;
	disk_used: string | null;
	disk_total: string | null;
	disk_r_sec: string | null;
	disk_w_sec: string | null;
	db_size: string | null;
	conn_active: number | null;
	conn_max: number | null;
	cache_hit_ratio: number | null;
};

const toNumber = (v: string | number | null): number | null => {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
};

const rowToStats = (row: Row): DbServerStats => ({
	ts: row.ts.toISOString(),
	hostId: row.host_id,
	cpu: toNumber(row.cpu),
	memUsed: toNumber(row.mem_used),
	memTotal: toNumber(row.mem_total),
	diskUsed: toNumber(row.disk_used),
	diskTotal: toNumber(row.disk_total),
	diskRSec: toNumber(row.disk_r_sec),
	diskWSec: toNumber(row.disk_w_sec),
	dbSize: toNumber(row.db_size),
	connActive: toNumber(row.conn_active),
	connMax: toNumber(row.conn_max),
	cacheHitRatio: toNumber(row.cache_hit_ratio),
});

@Injectable()
export class DbServerStatsService implements OnApplicationShutdown {
	private intervalId: NodeJS.Timeout | null = null;
	private lastTs: string | null = null;
	private readonly log: DbServerStats[] = [];

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.db)
		private db: DataSource,
	) {
	}

	@bindThis
	public async start(): Promise<void> {
		if (!this.meta.enableDbServerStats) return;

		ev.on('requestDbServerStatsLog', x => {
			ev.emit(`dbServerStatsLog:${x.id}`, this.log.slice(0, x.length));
		});

		await this.tick();
		this.intervalId = setInterval(() => { this.tick(); }, interval);
	}

	@bindThis
	private async tick(): Promise<void> {
		try {
			const rows: Row[] = await this.db.query(
				'SELECT * FROM "db_server_stats" ORDER BY "ts" DESC LIMIT 1',
			);
			if (rows.length === 0) return;
			const stats = rowToStats(rows[0]);

			// 同じ ts の行は配信しない（収集スクリプトがまだ次の行を入れていない）
			if (stats.ts === this.lastTs) return;
			this.lastTs = stats.ts;

			ev.emit('dbServerStats', stats);
			this.log.unshift(stats);
			if (this.log.length > logCapacity) this.log.pop();
		} catch (err) {
			// DB 不通時に setInterval を止めない。次の tick で回復するかもしれない
		}
	}

	@bindThis
	public dispose(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
