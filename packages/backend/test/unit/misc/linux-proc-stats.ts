/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
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

// 実機の /proc/net/route の形 (区切りはタブ)
const procNetRoute = [
	'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT                                                       ',
	'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0                                                                               ',
	'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0                                                                               ',
	'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0                                                                              ',
	'',
].join('\n');

const procNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 2776770   11307    0    0    0     0          0         0  2776770   11307    0    0    0     0       0          0
  eth0:1215645000 1061000    0    0    0     0          0         0 82530600  598000    0    0    0     0       0          0
docker0:       0       0    0    0    0     0          0         0        0       0    0    5    0     0       0          0
veth1a2b3c4: 1234 12 0 0 0 0 0 0 5678 34 0 0 0 0 0 0
`;

const procDiskstats = `   7       0 loop0 52 0 2156 13 0 0 0 0 0 40 13 0 0 0 0 0 0
   8       0 sda 120345 3456 9876543 45678 230456 12345 7654321 98765 0 123456 144443 0 0 0 0 1000 200
   8       1 sda1 120000 3400 9800000 45600 230000 12300 7650000 98700 0 123400 144300 0 0 0 0 0 0
 259       0 nvme0n1 5000 0 400000 1000 6000 0 500000 2000 0 3000 3000 0 0 0 0 0 0
 259       1 nvme0n1p1 4900 0 390000 990 5900 0 490000 1990 0 2990 2980 0 0 0 0 0 0
 253       0 dm-0 99999 0 1 1 99999 0 1 1 0 1 1
  11       0 sr0 10 0 40 1 0 0 0 0 0 1 1 0 0 0 0 0 0
 104       0 cciss/c0d0 7 0 0 0 8 0 0 0 0 0 0
`;

describe('misc:linux-proc-stats', () => {
	describe('parseDefaultRouteInterface', () => {
		test('既定経路のインターフェースを返す', () => {
			expect(parseDefaultRouteInterface(procNetRoute)).toBe('eth0');
		});

		test('既定経路が複数あれば Metric が最小のものを返す', () => {
			const text = [
				'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
				'wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
				'eth0\t00000000\t0102A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
			].join('\n');
			expect(parseDefaultRouteInterface(text)).toBe('eth0');
		});

		test('RTF_UP が立っていない経路は使わない', () => {
			const text = [
				'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
				'eth0\t00000000\t0101A8C0\t0002\t0\t0\t100\t00000000\t0\t0\t0',
			].join('\n');
			expect(parseDefaultRouteInterface(text)).toBeNull();
		});

		test('既定経路がなければ null', () => {
			expect(parseDefaultRouteInterface(procNetRoute.split('\n').filter(l => !l.startsWith('eth0\t00000000')).join('\n'))).toBeNull();
			expect(parseDefaultRouteInterface('')).toBeNull();
		});
	});

	describe('pickFallbackInterface', () => {
		test('外部インターフェースのうち scopeid が最小のものを選ぶ', () => {
			expect(pickFallbackInterface({
				lo: [{ internal: true }],
				eth0: [{ internal: false }, { internal: false, scopeid: 5 }],
				eth1: [{ internal: false, scopeid: 2 }],
			})).toBe('eth1');
		});

		test('scopeid がなければ最初の外部インターフェースを選ぶ', () => {
			expect(pickFallbackInterface({
				lo: [{ internal: true }],
				eth0: [{ internal: false }],
				eth1: [{ internal: false }],
			})).toBe('eth0');
		});

		test('外部インターフェースがなければ null', () => {
			expect(pickFallbackInterface({ lo: [{ internal: true }] })).toBeNull();
		});
	});

	describe('parseProcNetDev', () => {
		test('インターフェースごとの受信・送信バイト数を返す', () => {
			const result = parseProcNetDev(procNetDev);
			expect(result.get('lo')).toEqual({ rxBytes: 2776770, txBytes: 2776770 });
			expect(result.get('eth0')).toEqual({ rxBytes: 1215645000, txBytes: 82530600 });
			expect(result.get('docker0')).toEqual({ rxBytes: 0, txBytes: 0 });
			expect(result.get('veth1a2b3c4')).toEqual({ rxBytes: 1234, txBytes: 5678 });
		});

		test('見出しの行は含めない', () => {
			const result = parseProcNetDev(procNetDev);
			expect([...result.keys()]).toEqual(['lo', 'eth0', 'docker0', 'veth1a2b3c4']);
		});
	});

	describe('parseProcDiskstats', () => {
		test('デバイスごとの読み書きの完了回数を返す', () => {
			const result = parseProcDiskstats(procDiskstats);
			expect(result.find(e => e.name === 'sda')).toEqual({ major: 8, minor: 0, name: 'sda', readIos: 120345, writeIos: 230456 });
			expect(result.find(e => e.name === 'nvme0n1')).toEqual({ major: 259, minor: 0, name: 'nvme0n1', readIos: 5000, writeIos: 6000 });
			// 古いカーネルの 14 列の行も読める
			expect(result.find(e => e.name === 'dm-0')).toEqual({ major: 253, minor: 0, name: 'dm-0', readIos: 99999, writeIos: 99999 });
			expect(result.find(e => e.name === 'cciss/c0d0')).toEqual({ major: 104, minor: 0, name: 'cciss/c0d0', readIos: 7, writeIos: 8 });
			expect(result).toHaveLength(8);
		});
	});

	describe('isLsblkDisk', () => {
		test('普通のディスクは数える', () => {
			expect(isLsblkDisk('sda', 8, 0)).toBe(true);
			expect(isLsblkDisk('vda', 252, null)).toBe(true);
			expect(isLsblkDisk('nvme0n1', 259, null)).toBe(true);
			expect(isLsblkDisk('xvda', 202, null)).toBe(true);
			expect(isLsblkDisk('zram0', 251, null)).toBe(true);
		});

		test('lsblk の TYPE が disk でないものは数えない', () => {
			expect(isLsblkDisk('dm-0', 253, null)).toBe(false);
			expect(isLsblkDisk('loop0', 7, null)).toBe(false);
			expect(isLsblkDisk('md0', 9, null)).toBe(false);
			expect(isLsblkDisk('sr0', 11, 5)).toBe(false);
			expect(isLsblkDisk('st0', 9, 1)).toBe(false);
		});

		test('lsblk が既定で表示しない RAM ディスクは数えない', () => {
			expect(isLsblkDisk('ram0', 1, null)).toBe(false);
		});
	});

	describe('parseSysfsInt / sysBlockNameToDiskstatsName', () => {
		test('sysfs の整数を読む', () => {
			expect(parseSysfsInt('5\n')).toBe(5);
			expect(parseSysfsInt('0')).toBe(0);
			expect(parseSysfsInt('pcie\n')).toBeNull();
			expect(parseSysfsInt('')).toBeNull();
		});

		test('/sys/block の名前を /proc/diskstats の名前に直す', () => {
			expect(sysBlockNameToDiskstatsName('cciss!c0d0')).toBe('cciss/c0d0');
			expect(sysBlockNameToDiskstatsName('sda')).toBe('sda');
		});
	});

	describe('pickDiskIoCounters / calcDiskIoPerSec', () => {
		const disks = new Set(['sda', 'nvme0n1']);

		test('指定したデバイスだけを取り出す (パーティションや dm は含めない)', () => {
			const counters = pickDiskIoCounters(parseProcDiskstats(procDiskstats), disks);
			expect([...counters.keys()]).toEqual(['sda', 'nvme0n1']);
		});

		test('デバイスごとの差を足して毎秒の回数にする', () => {
			const prev = pickDiskIoCounters(parseProcDiskstats(procDiskstats), disks);
			const cur = new Map(prev);
			cur.set('sda', { readIos: 120345 + 30, writeIos: 230456 + 50 });
			cur.set('nvme0n1', { readIos: 5000 + 10, writeIos: 6000 + 4 });
			expect(calcDiskIoPerSec(prev, cur, 2000)).toEqual({ rIoSec: 20, wIoSec: 27 });
		});

		test('途中で現れたデバイスは数えない', () => {
			const prev = new Map([['sda', { readIos: 100, writeIos: 100 }]]);
			const cur = new Map([
				['sda', { readIos: 110, writeIos: 120 }],
				['sdb', { readIos: 999999, writeIos: 999999 }],
			]);
			expect(calcDiskIoPerSec(prev, cur, 1000)).toEqual({ rIoSec: 10, wIoSec: 20 });
		});

		test('カウンターが減ったデバイスは 0 として扱う', () => {
			const prev = new Map([['sda', { readIos: 100, writeIos: 100 }]]);
			const cur = new Map([['sda', { readIos: 5, writeIos: 110 }]]);
			expect(calcDiskIoPerSec(prev, cur, 1000)).toEqual({ rIoSec: 0, wIoSec: 10 });
		});

		test('経過時間が 0 以下なら 0', () => {
			const prev = new Map([['sda', { readIos: 100, writeIos: 100 }]]);
			const cur = new Map([['sda', { readIos: 110, writeIos: 110 }]]);
			expect(calcDiskIoPerSec(prev, cur, 0)).toEqual({ rIoSec: 0, wIoSec: 0 });
		});
	});

	describe('calcPerSec', () => {
		test('差を経過時間で割る', () => {
			expect(calcPerSec(1000, 5000, 2000)).toBe(2000);
		});

		test('差が負なら 0', () => {
			expect(calcPerSec(5000, 1000, 2000)).toBe(0);
		});

		test('経過時間が 0 以下なら 0', () => {
			expect(calcPerSec(1000, 5000, 0)).toBe(0);
		});
	});
});
