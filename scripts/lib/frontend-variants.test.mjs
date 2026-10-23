/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVariantList } from './frontend-variants.mjs';

test('mode を省略すると merge になる', () => {
	const { variants, errors } = parseVariantList('- name: a\n  branch: riin/feat/a\n');
	assert.deepEqual(variants, [{ name: 'a', branch: 'riin/feat/a', mode: 'merge' }]);
	assert.deepEqual(errors, []);
});

test('as-is を受け付ける', () => {
	const { variants } = parseVariantList('- name: a\n  branch: riin/check/a\n  mode: as-is\n');
	assert.equal(variants[0].mode, 'as-is');
});

test('空ファイルは variant なし', () => {
	assert.deepEqual(parseVariantList(''), { variants: [], errors: [] });
});

test('トップレベルが配列でなければ全体をエラーにする', () => {
	const { variants, errors } = parseVariantList('name: a\n');
	assert.deepEqual(variants, []);
	assert.equal(errors.length, 1);
});

test('YAML として壊れていたら全体をエラーにする', () => {
	const { variants, errors } = parseVariantList('- name: [\n');
	assert.deepEqual(variants, []);
	assert.equal(errors.length, 1);
});

test('不正な名前・ブランチ・mode の要素はエラーに回し、残りは通す', () => {
	const { variants, errors } = parseVariantList([
		'- name: ok',
		'  branch: riin/feat/ok',
		'- name: ../bad',
		'  branch: riin/feat/x',
		'- name: opt',
		'  branch: --upload-pack=evil',
		'- name: mode',
		'  branch: riin/feat/y',
		'  mode: rebase',
		'- name: nobranch',
	].join('\n'));
	assert.deepEqual(variants.map(v => v.name), ['ok']);
	assert.deepEqual(errors.map(e => e.name), ['../bad', 'opt', 'mode', 'nobranch']);
});

test('名前が重複したら 2 つ目以降をエラーにする', () => {
	const { variants, errors } = parseVariantList('- name: a\n  branch: b1\n- name: a\n  branch: b2\n');
	assert.deepEqual(variants.map(v => v.branch), ['b1']);
	assert.equal(errors[0].branch, 'b2');
});
