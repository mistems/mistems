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

/** db_server_stats を見に行く間隔。収集スクリプトの既定の実行間隔 (60 秒) より短くして、新しい行を待たせすぎない */
const interval = 30 * 1000;

/** requestLog で返す最大件数 */
const logCapacity = 200;

/** 最後の dbServerStatsWatching からこの時間がたったら SELECT を止める */
const watchTimeout = 5 * 60 * 1000;

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
	private lastWatchedAt = 0;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.db)
		private db: DataSource,
	) {
	}

	@bindThis
	public start(): void {
		// 履歴は db_server_stats テーブルにあるので、メモリには持たずに毎回 SELECT する
		ev.on('requestDbServerStatsLog', async x => {
			const length = Math.min(Math.max(Math.trunc(x.length), 0), logCapacity);
			const log = this.meta.enableDbServerStats ? await this.fetch(length) : [];
			ev.emit(`dbServerStatsLog:${x.id}`, log);
		});

		// dbServerStats チャンネルを購読している人がいる間だけ SELECT する
		ev.on('dbServerStatsWatching', () => {
			this.lastWatchedAt = Date.now();
		});

		this.intervalId = setInterval(() => { this.tick(); }, interval);
	}

	@bindThis
	private async fetch(limit: number): Promise<DbServerStats[]> {
		if (limit === 0) return [];
		try {
			const rows: Row[] = await this.db.query(
				'SELECT * FROM "db_server_stats" ORDER BY "ts" DESC LIMIT $1',
				[limit],
			);
			return rows.map(rowToStats);
		} catch {
			// DB 不通時やテーブルの権限がないときは空にする。次の tick で回復するかもしれない
			return [];
		}
	}

	@bindThis
	private async tick(): Promise<void> {
		// 管理画面での切り替えを再起動なしで反映するため、毎回フラグを見る
		if (!this.meta.enableDbServerStats) return;
		if (Date.now() - this.lastWatchedAt >= watchTimeout) return;

		const [stats] = await this.fetch(1);
		if (stats == null) return;

		// 同じ ts の行は配信しない（収集スクリプトがまだ次の行を入れていない）
		if (stats.ts === this.lastTs) return;
		this.lastTs = stats.ts;

		ev.emit('dbServerStats', stats);
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
