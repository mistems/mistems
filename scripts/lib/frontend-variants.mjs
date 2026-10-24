/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { loadAll as loadAllYaml } from 'js-yaml';

// backend の packages/backend/src/server/web/frontend-variant.ts と同じ規則
const VARIANT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
// git のオプションと誤認されないよう、先頭の '-' を禁止する
const BRANCH_RE = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
const MODES = ['merge', 'as-is'];

/**
 * frontend-variants.yml の内容を検証する。
 * @param {string} yamlText
 * @returns {{ variants: { name: string, branch: string, mode: 'merge' | 'as-is' }[], errors: { name: string, branch: string, reason: string }[] }}
 */
export function parseVariantList(yamlText) {
	let docs;
	try {
		// js-yaml の load は空・コメントだけのファイルで例外を投げるため loadAll を使う
		docs = loadAllYaml(yamlText);
	} catch (e) {
		return { variants: [], errors: [{ name: '(全体)', branch: '', reason: `frontend-variants.yml を読めない: ${e.message}` }] };
	}
	if (docs.length === 0) return { variants: [], errors: [] };
	if (docs.length > 1) {
		return { variants: [], errors: [{ name: '(全体)', branch: '', reason: 'frontend-variants.yml は 1 つのドキュメントにする' }] };
	}
	const doc = docs[0];
	if (!Array.isArray(doc)) {
		return { variants: [], errors: [{ name: '(全体)', branch: '', reason: 'frontend-variants.yml のトップレベルが配列ではない' }] };
	}

	const variants = [];
	const errors = [];
	const seen = new Set();
	for (const item of doc) {
		const name = String(item?.name ?? '?');
		const branch = String(item?.branch ?? '');
		const mode = item?.mode ?? 'merge';
		const fail = (reason) => errors.push({ name, branch, reason });

		if (!VARIANT_NAME_RE.test(name)) { fail('name は英数字・ハイフン・アンダースコアの 1〜64 文字にする'); continue; }
		if (!BRANCH_RE.test(branch)) { fail('branch が空、または使えない文字を含む'); continue; }
		if (!MODES.includes(mode)) { fail(`mode は ${MODES.join(' / ')} のどれかにする`); continue; }
		if (seen.has(name)) { fail('name が重複している'); continue; }
		seen.add(name);
		variants.push({ name, branch, mode });
	}
	return { variants, errors };
}
