/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import Xev from 'xev';
import * as osUtils from 'os-utils';
import { bindThis } from '@/decorators.js';
import { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import {
	calcDiskIoPerSec,
	calcPerSec,
	isLsblkDisk,
	parseDefaultRouteInterface,
	parseProcDiskstats,
	parseProcNetDev,
	parseSysfsInt,
	pickDiskIoCounters,
	pickFallbackInterface,
	sysBlockNameToDiskstatsName,
} from '@/misc/linux-proc-stats.js';
import type { DiskIoCounters } from '@/misc/linux-proc-stats.js';
import type { OnApplicationShutdown } from '@nestjs/common';

const ev = new Xev();

const interval = 2000;

/** 最後の serverStatsWatching からこの時間がたったら収集を止める */
const watchTimeout = 5 * 60 * 1000;

/** 既定のネットワークインターフェースが求められなかったときに再試行するまでの時間 */
const ifaceRetryInterval = 60 * 1000;

/** 数えるディスクの一覧を読み直す間隔 */
const diskListRefreshInterval = 5 * 60 * 1000;

/** 前回の値からこれより時間が空いたら、差を毎秒の値にせず最初の 1 回として扱う */
const maxSampleGap = interval * 5;

const isLinux = process.platform === 'linux';

const roundCpu = (num: number) => Math.round(num * 1000) / 1000;
const round = (num: number) => Math.round(num * 10) / 10;

@Injectable()
export class ServerStatsService implements OnApplicationShutdown {
	private intervalId: NodeJS.Timeout | null = null;
	private lastWatchedAt = 0;
	private collecting = false;
	private readonly netDisk = isLinux ? new LinuxNetDiskReader() : new SiNetDiskReader();

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,
	) {
	}

	/**
	 * Report server stats regularly
	 */
	@bindThis
	public async start(): Promise<void> {
		if (!this.meta.enableServerMachineStats) return;

		const log = [] as any[];

		ev.on('requestServerStatsLog', x => {
			ev.emit(`serverStatsLog:${x.id}`, log.slice(0, x.length));
		});

		// serverStats チャンネルを購読している人がいる間だけ収集する
		ev.on('serverStatsWatching', () => {
			this.lastWatchedAt = Date.now();
		});

		const tick = async () => {
			const watching = Date.now() - this.lastWatchedAt < watchTimeout;
			if (!watching) {
				if (this.collecting) {
					this.collecting = false;
					// 再開したときに古い値を新しい値と並べないよう、止めるときにログを捨てる
					log.length = 0;
					this.netDisk.reset();
				}
				return;
			}
			this.collecting = true;

			const cpu = await cpuUsage();
			const memStats = await mem();
			const netStats = await this.netDisk.net();
			const fsStats = await this.netDisk.disk();

			const stats = {
				cpu: roundCpu(cpu),
				mem: {
					used: round(memStats.total - memStats.available),
					active: round(memStats.active),
				},
				net: {
					rx: round(Math.max(0, netStats.rx_sec ?? 0)),
					tx: round(Math.max(0, netStats.tx_sec ?? 0)),
				},
				fs: {
					r: round(Math.max(0, fsStats.rIO_sec ?? 0)),
					w: round(Math.max(0, fsStats.wIO_sec ?? 0)),
				},
			};
			ev.emit('serverStats', stats);
			log.unshift(stats);
			if (log.length > 200) log.pop();
		};

		tick();

		this.intervalId = setInterval(tick, interval);
	}

	@bindThis
	public dispose(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
		}
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}

type NetStats = { rx_sec: number | null; tx_sec: number | null };
type DiskStats = { rIO_sec: number | null; wIO_sec: number | null };

interface NetDiskReader {
	net(): Promise<NetStats>;
	disk(): Promise<DiskStats>;
	/** 前回の値を捨て、次の 1 回を最初の 1 回として扱わせる */
	reset(): void;
}

/**
 * 既定のネットワークインターフェース名を一度だけ求めて使い回す。
 * 求められなかったときは ifaceRetryInterval あけて再試行する。
 */
class DefaultInterfaceCache {
	private iface: string | null = null;
	private nextRetryAt = 0;

	constructor(private readonly resolve: () => Promise<string | null>) {
	}

	public async get(): Promise<string | null> {
		if (this.iface != null) return this.iface;
		const now = Date.now();
		if (now < this.nextRetryAt) return null;
		const iface = await this.resolve().catch(() => null);
		if (iface) {
			this.iface = iface;
		} else {
			this.nextRetryAt = now + ifaceRetryInterval;
		}
		return this.iface;
	}
}

/**
 * Linux では /proc と /sys を直接読み、子プロセスを起動せずに
 * systeminformation の networkStats() と disksIO() と同じ意味の値を求める。
 */
class LinuxNetDiskReader implements NetDiskReader {
	private readonly iface = new DefaultInterfaceCache(async () => {
		const route = await fs.readFile('/proc/net/route', 'utf8').catch(() => '');
		return parseDefaultRouteInterface(route) ?? pickFallbackInterface(os.networkInterfaces());
	});

	private prevNet: { iface: string; rxBytes: number; txBytes: number; at: number } | null = null;

	private diskNames: Set<string> | null = null;
	private diskNamesAt = 0;
	private prevDisk: { counters: DiskIoCounters; at: number } | null = null;

	public async net(): Promise<NetStats> {
		const iface = await this.iface.get();
		if (iface == null) return { rx_sec: null, tx_sec: null };

		const text = await fs.readFile('/proc/net/dev', 'utf8').catch(() => null);
		const at = Date.now();
		const cur = text == null ? undefined : parseProcNetDev(text).get(iface);
		if (cur == null) {
			this.prevNet = null;
			return { rx_sec: null, tx_sec: null };
		}

		const prev = this.prevNet;
		this.prevNet = { iface, rxBytes: cur.rxBytes, txBytes: cur.txBytes, at };
		if (prev == null || prev.iface !== iface || at - prev.at > maxSampleGap) {
			return { rx_sec: 0, tx_sec: 0 };
		}
		const elapsed = at - prev.at;
		return {
			rx_sec: calcPerSec(prev.rxBytes, cur.rxBytes, elapsed),
			tx_sec: calcPerSec(prev.txBytes, cur.txBytes, elapsed),
		};
	}

	public async disk(): Promise<DiskStats> {
		const diskNames = await this.getDiskNames();
		const text = await fs.readFile('/proc/diskstats', 'utf8').catch(() => null);
		const at = Date.now();
		if (text == null) {
			this.prevDisk = null;
			return { rIO_sec: 0, wIO_sec: 0 };
		}
		const counters = pickDiskIoCounters(parseProcDiskstats(text), diskNames);

		const prev = this.prevDisk;
		this.prevDisk = { counters, at };
		if (prev == null || at - prev.at > maxSampleGap) {
			return { rIO_sec: 0, wIO_sec: 0 };
		}
		const { rIoSec, wIoSec } = calcDiskIoPerSec(prev.counters, counters, at - prev.at);
		return { rIO_sec: rIoSec, wIO_sec: wIoSec };
	}

	public reset(): void {
		this.prevNet = null;
		this.prevDisk = null;
	}

	/**
	 * `lsblk` の TYPE が disk のデバイス (systeminformation の disksIO() が数えるもの) の名前を、
	 * /proc/diskstats での名前で返す。
	 */
	private async getDiskNames(): Promise<Set<string>> {
		const now = Date.now();
		if (this.diskNames != null && now - this.diskNamesAt < diskListRefreshInterval) return this.diskNames;

		const names = new Set<string>();
		const entries = await fs.readdir('/sys/block').catch(() => [] as string[]);
		for (const name of entries) {
			const dev = await fs.readFile(`/sys/block/${name}/dev`, 'utf8').catch(() => null);
			const major = dev == null ? null : parseSysfsInt(dev.split(':')[0]);
			const typeText = await fs.readFile(`/sys/block/${name}/device/type`, 'utf8').catch(() => null);
			const scsiType = typeText == null ? null : parseSysfsInt(typeText);
			if (isLsblkDisk(name, major, scsiType)) {
				names.add(sysBlockNameToDiskstatsName(name));
			}
		}

		this.diskNames = names;
		this.diskNamesAt = now;
		return names;
	}
}

/**
 * Linux 以外 (開発環境の macOS など) では systeminformation を使う。
 * 既定のネットワークインターフェース名だけは使い回す。
 */
class SiNetDiskReader implements NetDiskReader {
	private readonly iface = new DefaultInterfaceCache(async () => {
		const si = await import('systeminformation');
		return await si.networkInterfaceDefault();
	});

	public async net(): Promise<NetStats> {
		const iface = await this.iface.get();
		if (iface == null) return { rx_sec: null, tx_sec: null };
		const si = await import('systeminformation');
		const data = await si.networkStats(iface);
		return data[0] ?? { rx_sec: null, tx_sec: null };
	}

	public async disk(): Promise<DiskStats> {
		const si = await import('systeminformation');
		const data = await si.disksIO().catch(() => null);
		return data ?? { rIO_sec: 0, wIO_sec: 0 };
	}

	public reset(): void {
		// systeminformation が前回の値を持っているので、ここでは何もしない
	}
}

// CPU STAT
function cpuUsage(): Promise<number> {
	return new Promise((res, rej) => {
		osUtils.cpuUsage((cpuUsage) => {
			res(cpuUsage);
		});
	});
}

// MEMORY STAT
// Linux では /proc/meminfo を fs.readFile で読むだけで、子プロセスを起動しない
async function mem() {
	const si = await import('systeminformation');
	const data = await si.mem();
	return data;
}
