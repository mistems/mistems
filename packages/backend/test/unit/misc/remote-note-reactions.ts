/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	computeTargetReactionCounts,
	isMisskeyCompatibleSoftware,
	mapRemoteReactionKey,
	mapRemoteReactions,
	mergeRemoteReactions,
	parseMisskeyNoteUri,
	planReactionCountUpdates,
	selectStaleReactionUserIds,
	toReactionForCreate,
} from '@/misc/remote-note-reactions.js';

const REMOTE = 'misskey.systems';
const LOCAL = 'gamelore.example';

describe('isMisskeyCompatibleSoftware', () => {
	test('Misskey 系のソフトウェアは true を返す', () => {
		for (const name of ['misskey', 'sharkey', 'cherrypick', 'firefish', 'iceshrimp', 'foundkey']) {
			expect(isMisskeyCompatibleSoftware(name)).toBe(true);
		}
	});

	test('大文字が混じっていても判定できる', () => {
		expect(isMisskeyCompatibleSoftware('Misskey')).toBe(true);
	});

	test('Mastodon などは false を返す', () => {
		expect(isMisskeyCompatibleSoftware('mastodon')).toBe(false);
		expect(isMisskeyCompatibleSoftware('pleroma')).toBe(false);
		expect(isMisskeyCompatibleSoftware(null)).toBe(false);
		expect(isMisskeyCompatibleSoftware(undefined)).toBe(false);
	});
});

describe('parseMisskeyNoteUri', () => {
	test('https://<host>/notes/<id> から id を取り出す', () => {
		expect(parseMisskeyNoteUri('https://misskey.systems/notes/asq39a3cb0', REMOTE)).toBe('asq39a3cb0');
	});

	test('ホストが違うときは null を返す', () => {
		expect(parseMisskeyNoteUri('https://evil.example/notes/asq39a3cb0', REMOTE)).toBeNull();
	});

	test('形が違うときは null を返す', () => {
		expect(parseMisskeyNoteUri('https://misskey.systems/users/abc/statuses/1', REMOTE)).toBeNull();
		expect(parseMisskeyNoteUri('https://misskey.systems/notes/abc/extra', REMOTE)).toBeNull();
		expect(parseMisskeyNoteUri('https://misskey.systems/notes/abc?x=1', REMOTE)).toBeNull();
		expect(parseMisskeyNoteUri('http://misskey.systems/notes/abc', REMOTE)).toBeNull();
		expect(parseMisskeyNoteUri('not a url', REMOTE)).toBeNull();
	});
});

describe('mapRemoteReactionKey', () => {
	test('Unicode の絵文字はそのまま', () => {
		expect(mapRemoteReactionKey('👍', REMOTE, LOCAL)).toEqual({ key: '👍', emoji: null });
		expect(mapRemoteReactionKey('❤', REMOTE, LOCAL)).toEqual({ key: '❤', emoji: null });
	});

	test(':name@.: は相手のホストの絵文字にする', () => {
		expect(mapRemoteReactionKey(':owa_desuwa@.:', REMOTE, LOCAL)).toEqual({
			key: ':owa_desuwa@misskey.systems:',
			emoji: { name: 'owa_desuwa', host: REMOTE, isRemoteLocal: true },
		});
	});

	test(':name@other.host: はそのまま (第三のサーバーの絵文字)', () => {
		expect(mapRemoteReactionKey(':blobcat@other.example:', REMOTE, LOCAL)).toEqual({
			key: ':blobcat@other.example:',
			emoji: { name: 'blobcat', host: 'other.example', isRemoteLocal: false },
		});
	});

	test(':name@<自分のホスト>: は自分のサーバーの絵文字 (DB 上の形 :name:) にする', () => {
		expect(mapRemoteReactionKey(':mine@gamelore.example:', REMOTE, LOCAL)).toEqual({ key: ':mine:', emoji: null });
	});

	test('不正なキーは null を返す', () => {
		expect(mapRemoteReactionKey('hello', REMOTE, LOCAL)).toBeNull();
		expect(mapRemoteReactionKey(':bad name@.:', REMOTE, LOCAL)).toBeNull();
		expect(mapRemoteReactionKey('', REMOTE, LOCAL)).toBeNull();
		expect(mapRemoteReactionKey('👍👍', REMOTE, LOCAL)).toBeNull();
	});
});

describe('mapRemoteReactions', () => {
	test('キーを変換し、不正な値は捨てる', () => {
		const res = mapRemoteReactions({
			':owa_desuwa@.:': 2,
			'👍': 3,
			'bogus': 5,
			'🎉': -1,
			'😆': 1.5,
			'🤔': 'x',
		}, REMOTE, LOCAL);
		expect(res.reactions).toEqual({
			':owa_desuwa@misskey.systems:': 2,
			'👍': 3,
		});
		expect(res.truncated).toBe(false);
		expect(res.emojis).toEqual([{ name: 'owa_desuwa', host: REMOTE, isRemoteLocal: true }]);
	});

	test('オブジェクトでなければ空を返す', () => {
		expect(mapRemoteReactions(null, REMOTE, LOCAL)).toEqual({ reactions: {}, emojis: [], truncated: false });
		expect(mapRemoteReactions(['👍'], REMOTE, LOCAL)).toEqual({ reactions: {}, emojis: [], truncated: false });
	});

	test('キーの数に上限がある', () => {
		const many: Record<string, number> = {};
		for (let i = 0; i < 300; i++) many[`:e${i}@.:`] = 1;
		const res = mapRemoteReactions(many, REMOTE, LOCAL, { maxKeys: 10 });
		expect(Object.keys(res.reactions)).toHaveLength(10);
		expect(res.emojis).toHaveLength(10);
		// 上限で切ったときは、減らす方向の同期をしないために印を付ける
		expect(res.truncated).toBe(true);
	});
});

describe('mergeRemoteReactions', () => {
	test('キーごとに max(自分の数, 相手の数) を取る', () => {
		const res = mergeRemoteReactions({ '👍': 5, '🎉': 1 }, { '👍': 3, '🎉': 4 });
		expect(res.merged).toEqual({ '👍': 5, '🎉': 4 });
		expect(res.changed).toEqual({ '🎉': 4 });
	});

	test('自分のサーバーにしか無いキーは残す', () => {
		const res = mergeRemoteReactions({ ':mine:': 2 }, { ':owa_desuwa@misskey.systems:': 2 });
		expect(res.merged).toEqual({ ':mine:': 2, ':owa_desuwa@misskey.systems:': 2 });
		expect(res.changed).toEqual({ ':owa_desuwa@misskey.systems:': 2 });
	});

	test('変わらないときは changed が空', () => {
		const res = mergeRemoteReactions({ '👍': 3 }, { '👍': 3 });
		expect(res.changed).toEqual({});
		expect(res.merged).toEqual({ '👍': 3 });
	});

	test('元のオブジェクトを変更しない', () => {
		const local = { '👍': 1 };
		mergeRemoteReactions(local, { '👍': 2 });
		expect(local).toEqual({ '👍': 1 });
	});
});

describe('computeTargetReactionCounts', () => {
	test('キーごとに max(相手の数, 行の数) を取る', () => {
		expect(computeTargetReactionCounts({ '👍': 3, '🎉': 1 }, { '👍': 1, '🎉': 2, '😆': 1 })).toEqual({ '👍': 3, '🎉': 2, '😆': 1 });
	});

	test('まだ書き込まれていないバッファの差分を引く', () => {
		expect(computeTargetReactionCounts({ '👍': 3 }, { '👍': 3 }, { '👍': 1 })).toEqual({ '👍': 2 });
		expect(computeTargetReactionCounts({ '👍': 1 }, {}, { '👍': 1 })).toEqual({});
	});
});

describe('toReactionForCreate', () => {
	test('付けたユーザーのホストの絵文字は :name: で渡す', () => {
		// 相手のサーバーのユーザーが、相手のサーバーの絵文字を付けた
		expect(toReactionForCreate(':owa_desuwa@.:', REMOTE, LOCAL, REMOTE)).toBe(':owa_desuwa:');
		// 第三のサーバーのユーザーが、そのサーバーの絵文字を付けた
		expect(toReactionForCreate(':blobcat@other.example:', REMOTE, LOCAL, 'other.example')).toBe(':blobcat:');
	});

	test('付けたユーザーのホストと違う絵文字は変換後のキーのまま渡す', () => {
		expect(toReactionForCreate(':blobcat@other.example:', REMOTE, LOCAL, REMOTE)).toBe(':blobcat@other.example:');
	});

	test('Unicode の絵文字はそのまま、不正なものは null', () => {
		expect(toReactionForCreate('👍', REMOTE, LOCAL, REMOTE)).toBe('👍');
		expect(toReactionForCreate('bogus', REMOTE, LOCAL, REMOTE)).toBeNull();
	});
});

describe('planReactionCountUpdates', () => {
	test('増やす方向だけ: 相手の数か行の数が多いキーだけを増やす', () => {
		expect(planReactionCountUpdates({ '👍': 5, '🎉': 1 }, { '👍': 3, '🎉': 4 }, { '🎉': 1 }, {}, { allowDecrease: false }))
			.toEqual({ '🎉': 4 });
	});

	test('減らす方向も: 相手で取り消されたら相手の数まで減る', () => {
		expect(planReactionCountUpdates({ '👍': 5 }, { '👍': 3 }, { '👍': 3 }, {}, { allowDecrease: true }))
			.toEqual({ '👍': 3 });
	});

	test('減らす方向も: 自分のサーバーにある行の数より下には減らさない (相手にまだ届いていないリアクション)', () => {
		expect(planReactionCountUpdates({ '👍': 5 }, { '👍': 1 }, { '👍': 2 }, {}, { allowDecrease: true }))
			.toEqual({ '👍': 2 });
	});

	test('減らす方向も: 相手に無いキーは行の数まで減らし、行も無ければ消す (0)', () => {
		expect(planReactionCountUpdates({ '🎉': 2, '😆': 3 }, {}, { '😆': 1 }, {}, { allowDecrease: true }))
			.toEqual({ '🎉': 0, '😆': 1 });
	});

	test('減らす方向も: 変わらないキーは含めない', () => {
		expect(planReactionCountUpdates({ '👍': 3 }, { '👍': 3 }, { '👍': 1 }, {}, { allowDecrease: true })).toEqual({});
	});

	test('バッファの差分を引いて合わせる', () => {
		// 表示は DB + 差分なので、DB は max(相手, 行) - 差分 にする
		expect(planReactionCountUpdates({ '👍': 4 }, { '👍': 2 }, { '👍': 2 }, { '👍': 1 }, { allowDecrease: true }))
			.toEqual({ '👍': 1 });
		expect(planReactionCountUpdates({}, { '👍': 2 }, {}, { '👍': 1 }, { allowDecrease: false }))
			.toEqual({ '👍': 1 });
	});
});

describe('selectStaleReactionUserIds', () => {
	test('相手の一覧に無いユーザーの行を返す', () => {
		const rows = [
			{ userId: 'a', usernameLower: 'alice' },
			{ userId: 'b', usernameLower: 'bob' },
		];
		expect(selectStaleReactionUserIds(rows, new Set(['alice']))).toEqual(['b']);
	});

	test('一覧に全員いれば空', () => {
		expect(selectStaleReactionUserIds([{ userId: 'a', usernameLower: 'alice' }], new Set(['alice']))).toEqual([]);
	});
});
