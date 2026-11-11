/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	buildVariantCookie,
	isValidVariantName,
	listVariants,
	parseVariantCookie,
	pickVariant,
	readVariantIndex,
} from '@/server/web/frontend-variant.js';

describe('isValidVariantName', () => {
	test('英数字・ハイフン・アンダースコアは有効', () => {
		expect(isValidVariantName('feat-foo_2')).toBe(true);
	});
	test('パス区切りやドットを含む名前は無効', () => {
		expect(isValidVariantName('../etc')).toBe(false);
		expect(isValidVariantName('a/b')).toBe(false);
		expect(isValidVariantName('a.b')).toBe(false);
	});
	test('空文字と 65 文字以上は無効', () => {
		expect(isValidVariantName('')).toBe(false);
		expect(isValidVariantName('a'.repeat(65))).toBe(false);
	});
});

describe('parseVariantCookie', () => {
	test('ヘッダーがなければ null', () => {
		expect(parseVariantCookie(undefined)).toBe(null);
	});
	test('他の Cookie と並んでいても値を取り出す', () => {
		expect(parseVariantCookie('a=1; mk_fe_variant=feat-x; b=2')).toBe('feat-x');
	});
	test('前後の空白を無視する', () => {
		expect(parseVariantCookie('  mk_fe_variant = feat-x ')).toBe('feat-x');
	});
	test('同名が重複していたら最初の値を使う', () => {
		expect(parseVariantCookie('mk_fe_variant=first; mk_fe_variant=second')).toBe('first');
	});
	test('= のない断片があっても例外を出さない', () => {
		expect(parseVariantCookie('garbage; mk_fe_variant=feat-x')).toBe('feat-x');
	});
	test('不正な名前は null', () => {
		expect(parseVariantCookie('mk_fe_variant=..%2Fetc')).toBe(null);
		expect(parseVariantCookie('mk_fe_variant=')).toBe(null);
	});
});

describe('pickVariant', () => {
	test('存在する variant を返す', () => {
		expect(pickVariant('mk_fe_variant=feat-x', ['feat-x'])).toBe('feat-x');
	});
	test('消えた variant は null', () => {
		expect(pickVariant('mk_fe_variant=gone', ['feat-x'])).toBe(null);
	});
});

describe('listVariants', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'fe-variants-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('ルートがなければ空配列', () => {
		expect(listVariants(join(root, 'missing'))).toEqual([]);
	});
	test('manifest.json を持つ有効な名前のディレクトリだけを名前順に返す', () => {
		for (const name of ['b-ok', 'a-ok', 'no-manifest', 'bad.name']) {
			mkdirSync(join(root, name));
		}
		writeFileSync(join(root, 'a-ok', 'manifest.json'), '{}');
		writeFileSync(join(root, 'b-ok', 'manifest.json'), '{}');
		writeFileSync(join(root, 'bad.name', 'manifest.json'), '{}');
		writeFileSync(join(root, 'file-not-dir'), '');
		expect(listVariants(root)).toEqual(['a-ok', 'b-ok']);
	});
});

describe('readVariantIndex', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'fe-variants-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const empty = { variants: [], skipped: [] };

	test('ファイルがなければ空', () => {
		expect(readVariantIndex(root)).toEqual(empty);
	});
	test('JSON が壊れていたら空', () => {
		writeFileSync(join(root, '_variants.json'), '{broken');
		expect(readVariantIndex(root)).toEqual(empty);
	});
	test('トップレベルが配列なら空', () => {
		writeFileSync(join(root, '_variants.json'), '[]');
		expect(readVariantIndex(root)).toEqual(empty);
	});
	test('variants / skipped が配列でなければそのキーは空', () => {
		writeFileSync(join(root, '_variants.json'), JSON.stringify({ variants: { name: 'a' }, skipped: 'x' }));
		expect(readVariantIndex(root)).toEqual(empty);
	});
	test('形の悪い要素と不正な mode を捨て、余分なフィールドを落とす', () => {
		writeFileSync(join(root, '_variants.json'), JSON.stringify({
			variants: [
				{ name: 'a', branch: 'riin/feat/a', mode: 'merge', extra: 1 },
				{ name: 'b', branch: 'riin/feat/b', mode: 'as-is' },
				{ name: 'c', branch: 'riin/feat/c', mode: 'other' },
				{ name: 'd', mode: 'merge' },
				'garbage',
			],
			skipped: [
				{ name: 'x', branch: 'riin/feat/x', reason: 'conflict', detail: 'secret' },
				{ name: 'y' },
				null,
			],
		}));
		expect(readVariantIndex(root)).toEqual({
			variants: [
				{ name: 'a', branch: 'riin/feat/a', mode: 'merge' },
				{ name: 'b', branch: 'riin/feat/b', mode: 'as-is' },
			],
			skipped: [{ name: 'x', branch: 'riin/feat/x', reason: 'conflict' }],
		});
	});
});

describe('buildVariantCookie', () => {
	test('設定用', () => {
		expect(buildVariantCookie('feat-x', true)).toBe('mk_fe_variant=feat-x; Path=/; Max-Age=604800; SameSite=Lax; Secure');
	});
	test('削除用（http）', () => {
		expect(buildVariantCookie(null, false)).toBe('mk_fe_variant=; Path=/; Max-Age=0; SameSite=Lax');
	});
});
