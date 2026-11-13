/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { url } from '@@/js/config.js';
import { TimeshiftPaginator } from './timeshiftPaginator.js';
import type * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';

// ノートの間隔。1 倍速でも数秒ごとにノートが流れてくるよう、短めにしている
const NOTE_INTERVAL_MS = 3000;
const INITIAL_COUNT = 15;
const PAGE_COUNT = 10;
// タイムフュージョン中に「いま投稿されたノート」を足す間隔
const LIVE_NOTE_INTERVAL_MS = 4000;

const USERNAMES = ['tm_sample_a', 'tm_sample_b', 'tm_sample_c', 'tm_sample_d'];

function sampleUser(index: number): Misskey.entities.UserLite {
	const username = USERNAMES[index % USERNAMES.length];
	return {
		id: `tmtour-user-${username}`,
		username,
		host: null,
		name: null,
		onlineStatus: 'unknown',
		avatarUrl: `${url}/identicon/${username}`,
		avatarBlurhash: null,
		avatarDecorations: [],
		emojis: {},
	};
}

function sampleNote(id: string, createdAt: number, text: string, userIndex: number): Misskey.entities.Note {
	const user = sampleUser(userIndex);
	return {
		id,
		createdAt: new Date(createdAt).toISOString(),
		text,
		cw: null,
		userId: user.id,
		user,
		visibility: 'public',
		reactionAcceptance: null,
		reactionEmojis: {},
		reactions: {},
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
	};
}

/**
 * タイムマシンの使い方ツアーで使う、API を呼ばずにサンプルのノートを返す Paginator
 *
 * ノートは baseTime を基準に一定の間隔で並んでいて、過去にも未来にも好きなだけ読み込める。
 * タイムフュージョン中は、いま投稿されたノートの代わりにサンプルのノートを定期的に足す。
 */
export class TimemachineTourPaginator extends TimeshiftPaginator {
	public readonly baseTime: number;
	private newestIndex = 0;
	private oldestIndex = 0;
	private liveCount = 0;
	private liveTimer: number | null = null;

	constructor(baseTime: number) {
		super('notes/hybrid-timeline', { initialDate: baseTime, initialDirection: 'older' });
		this.baseTime = baseTime;
	}

	private noteAt(index: number): Misskey.entities.Note {
		const texts = i18n.ts._timemachine._tourSample;
		const pastTexts = [texts.note1, texts.note2, texts.note3, texts.note4, texts.note5, texts.note6, texts.note7, texts.note8];
		const position = ((index % pastTexts.length) + pastTexts.length) % pastTexts.length;
		return sampleNote(`tmtour-${index}`, this.baseTime + index * NOTE_INTERVAL_MS, pastTexts[position], position);
	}

	public override async init(): Promise<void> {
		const notes: Misskey.entities.Note[] = [];
		for (let k = 0; k < INITIAL_COUNT; k++) notes.push(this.noteAt(-k));
		this.items.value = notes;
		this.newestIndex = 0;
		this.oldestIndex = -(INITIAL_COUNT - 1);
		this.canFetchOlder.value = true;
		this.canFetchNewer.value = true;
		this.error.value = false;
		this.fetching.value = false;
	}

	// サンプルは先読みしておく必要がないので、toQueue でもそのまま表示に足す
	protected override async fetchNewerBase(_options: { toQueue?: boolean }): Promise<void> {
		const notes: Misskey.entities.Note[] = [];
		for (let k = 1; k <= PAGE_COUNT; k++) {
			// いまより未来のノートは作らない
			if (this.baseTime + (this.newestIndex + k) * NOTE_INTERVAL_MS > Date.now()) break;
			notes.unshift(this.noteAt(this.newestIndex + k));
		}
		this.newestIndex += notes.length;
		if (notes.length === 0) {
			this.canFetchNewer.value = false;
			return;
		}
		this.unshiftItems(notes, false);
	}

	protected override async fetchOlderBase(): Promise<void> {
		const notes: Misskey.entities.Note[] = [];
		for (let k = 1; k <= PAGE_COUNT; k++) notes.push(this.noteAt(this.oldestIndex - k));
		this.oldestIndex -= PAGE_COUNT;
		this.pushItems(notes);
	}

	public override startTimefusion(): void {
		super.startTimefusion();
		this.stopLiveNotes();
		this.liveTimer = window.setInterval(() => {
			const texts = i18n.ts._timemachine._tourSample;
			const liveTexts = [texts.live1, texts.live2, texts.live3];
			const text = liveTexts[this.liveCount % liveTexts.length];
			this.addRealtimeItem(sampleNote(`tmtour-live-${this.liveCount}`, Date.now(), text, this.liveCount));
			this.liveCount++;
		}, LIVE_NOTE_INTERVAL_MS);
	}

	public override stopTimefusion(): void {
		super.stopTimefusion();
		this.stopLiveNotes();
	}

	private stopLiveNotes() {
		if (this.liveTimer != null) {
			window.clearInterval(this.liveTimer);
			this.liveTimer = null;
		}
	}

	public dispose(): void {
		this.stopLiveNotes();
	}
}
