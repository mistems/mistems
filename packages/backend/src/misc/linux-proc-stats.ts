/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Linux の /proc・/sys の内容を解析する純粋な関数。
 * ServerStatsService が systeminformation の代わりに使い、子プロセスを起動せずに
 * systeminformation と同じ意味の値を求める。
 */

const RTF_UP = 0x0001;

/**
 * /proc/net/route から既定経路 (Destination と Mask が 0) のインターフェース名を返す。
 * 複数あるときは Metric が最小のもの (同じなら先に現れたもの) を返す。見つからなければ null。
 */
export function parseDefaultRouteInterface(procNetRoute: string): string | null {
	let best: { iface: string; metric: number } | null = null;
	const lines = procNetRoute.split('\n');
	// 1 行目は見出し
	for (const line of lines.slice(1)) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 8) continue;
		const [iface, destination, , flagsHex, , , metricStr, mask] = cols;
		if (destination !== '00000000' || mask !== '00000000') continue;
		const flags = parseInt(flagsHex, 16);
		if (Number.isNaN(flags) || (flags & RTF_UP) === 0) continue;
		const parsedMetric = parseInt(metricStr, 10);
		const metric = Number.isNaN(parsedMetric) ? Number.MAX_SAFE_INTEGER : parsedMetric;
		if (best == null || metric < best.metric) {
			best = { iface, metric };
		}
	}
	return best?.iface ?? null;
}

type NetworkInterfaceInfoLike = { internal: boolean; scopeid?: number };

/**
 * 既定経路が見つからないときの代わりのインターフェース名を返す。
 * systeminformation の getDefaultNetworkInterface() と同じく、外部インターフェースのうち
 * scopeid が最小のもの、なければ最初に現れたものを選ぶ。見つからなければ null。
 */
export function pickFallbackInterface(ifaces: Record<string, NetworkInterfaceInfoLike[] | undefined>): string | null {
	let first: string | null = null;
	let byScope: string | null = null;
	let scopeid = 9999;
	for (const [dev, details] of Object.entries(ifaces)) {
		for (const d of details ?? []) {
			if (d.internal !== false) continue;
			first ??= dev;
			if (d.scopeid && d.scopeid < scopeid) {
				byScope = dev;
				scopeid = d.scopeid;
			}
		}
	}
	return byScope ?? first;
}

export type NetDevCounters = { rxBytes: number; txBytes: number };

/**
 * /proc/net/dev からインターフェースごとの受信・送信バイト数を返す。
 * /sys/class/net/<iface>/statistics/{rx,tx}_bytes と同じカウンターである。
 */
export function parseProcNetDev(procNetDev: string): Map<string, NetDevCounters> {
	const result = new Map<string, NetDevCounters>();
	for (const line of procNetDev.split('\n')) {
		const colon = line.indexOf(':');
		if (colon < 0) continue;
		const name = line.slice(0, colon).trim();
		// 見出しの行 ("Inter-|" と " face |") には ':' が含まれない
		if (name === '' || name.includes('|')) continue;
		const fields = line.slice(colon + 1).trim().split(/\s+/);
		if (fields.length < 9) continue;
		const rxBytes = parseInt(fields[0], 10);
		const txBytes = parseInt(fields[8], 10);
		if (Number.isNaN(rxBytes) || Number.isNaN(txBytes)) continue;
		result.set(name, { rxBytes, txBytes });
	}
	return result;
}

export type DiskstatsEntry = {
	major: number;
	minor: number;
	name: string;
	/** 読み込みの完了回数 (/sys/block/<dev>/stat の 1 列目) */
	readIos: number;
	/** 書き込みの完了回数 (/sys/block/<dev>/stat の 5 列目) */
	writeIos: number;
};

/**
 * /proc/diskstats をデバイスごとの読み書きの完了回数に分解する。
 */
export function parseProcDiskstats(procDiskstats: string): DiskstatsEntry[] {
	const result: DiskstatsEntry[] = [];
	for (const line of procDiskstats.split('\n')) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 8) continue;
		const major = parseInt(cols[0], 10);
		const minor = parseInt(cols[1], 10);
		const readIos = parseInt(cols[3], 10);
		const writeIos = parseInt(cols[7], 10);
		if ([major, minor, readIos, writeIos].some(Number.isNaN)) continue;
		result.push({ major, minor, name: cols[2], readIos, writeIos });
	}
	return result;
}

/**
 * SCSI のデバイス種別のうち、lsblk が disk 以外の名前を付けるもの
 * (util-linux の blkdev_scsi_type_to_name())。
 */
const NON_DISK_SCSI_TYPES = new Set([
	0x01, // tape
	0x02, // printer
	0x03, // processor
	0x04, // worm
	0x05, // rom
	0x06, // scanner
	0x07, // mo-disk
	0x08, // changer
	0x09, // comm
	0x0c, // raid
	0x0d, // enclosure
	0x0e, // rbc
	0x11, // osd
	0x7f, // no-lun
]);

/**
 * /sys/block の直下にあるデバイスについて、`lsblk` の TYPE が `disk` になるか (かつ lsblk が既定で表示するか) を返す。
 * systeminformation の disksIO() は `lsblk | grep " disk "` のデバイスだけを数えるので、それに合わせる。
 * 判定は util-linux の lsblk の get_type() による。/sys/block の直下にパーティションは現れない。
 *
 * @param name /sys/block の直下の名前 (例: sda, nvme0n1, dm-0)
 * @param major major 番号。不明なら null
 * @param scsiType /sys/block/<name>/device/type の値。ファイルがない・整数でなければ null
 */
export function isLsblkDisk(name: string, major: number | null, scsiType: number | null): boolean {
	// lsblk は既定で RAM ディスク (major 1) を表示しない
	if (major === 1) return false;
	if (name.startsWith('dm-')) return false; // lvm, crypt, mpath など
	if (name.startsWith('loop')) return false;
	if (name.startsWith('md')) return false; // raid1 など
	if (scsiType != null && NON_DISK_SCSI_TYPES.has(scsiType)) return false;
	return true;
}

/**
 * /sys/block の名前を /proc/diskstats の名前に直す (例: cciss!c0d0 → cciss/c0d0)。
 */
export function sysBlockNameToDiskstatsName(name: string): string {
	return name.replaceAll('!', '/');
}

/**
 * sysfs の整数の属性 (例: device/type) を解析する。整数でなければ null。
 */
export function parseSysfsInt(content: string): number | null {
	const trimmed = content.trim();
	if (!/^-?\d+$/.test(trimmed)) return null;
	return parseInt(trimmed, 10);
}

export type DiskIoCounters = Map<string, { readIos: number; writeIos: number }>;

/**
 * diskstats の中から指定したデバイスの読み書きの完了回数を取り出す。
 */
export function pickDiskIoCounters(entries: DiskstatsEntry[], diskNames: ReadonlySet<string>): DiskIoCounters {
	const result: DiskIoCounters = new Map();
	for (const e of entries) {
		if (!diskNames.has(e.name)) continue;
		result.set(e.name, { readIos: e.readIos, writeIos: e.writeIos });
	}
	return result;
}

/**
 * 前回と今回の読み書きの完了回数から、毎秒の回数を求める。
 * 両方に現れたデバイスの差だけを足すので、途中でデバイスが増減しても値が跳ねない。
 * 差が負になったデバイス (カウンターのリセットなど) は 0 として扱う。
 */
export function calcDiskIoPerSec(prev: DiskIoCounters, cur: DiskIoCounters, elapsedMs: number): { rIoSec: number; wIoSec: number } {
	if (elapsedMs <= 0) return { rIoSec: 0, wIoSec: 0 };
	let r = 0;
	let w = 0;
	for (const [name, c] of cur) {
		const p = prev.get(name);
		if (p == null) continue;
		r += Math.max(0, c.readIos - p.readIos);
		w += Math.max(0, c.writeIos - p.writeIos);
	}
	return { rIoSec: r / (elapsedMs / 1000), wIoSec: w / (elapsedMs / 1000) };
}

/**
 * 前回と今回のカウンターから毎秒の値を求める。差が負なら 0 (systeminformation の networkStats() と同じ)。
 */
export function calcPerSec(prev: number, cur: number, elapsedMs: number): number {
	if (elapsedMs <= 0) return 0;
	const diff = cur - prev;
	if (diff < 0) return 0;
	return diff / (elapsedMs / 1000);
}
