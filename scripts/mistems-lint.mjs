/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MISTEMS 独自の lint (packages/frontend/eslint.mistems.config.js) を実行する。main-統合.sh の最後に呼ぶ。
// 違反があれば、違反した行を入れたコミットを git blame で引き、main-統合.sh の squash_merge から直すべきブランチを示す。
//
// 使い方: node scripts/mistems-lint.mjs
// 終了コード: 0 = 違反なし / 1 = 違反あり / 2 = lint を実行できなかった

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integrationScript = join(repoRoot, 'main-統合.sh');

/** 検査する package と、その package で使う設定ファイル */
const targets = [
	{ dir: 'packages/frontend', config: 'eslint.mistems.config.js', patterns: ['src/**/*.{ts,vue}'] },
];

function git(args) {
	const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return res.status === 0 ? res.stdout : null;
}

function runEslint(target) {
	const cwd = join(repoRoot, target.dir);
	const res = spawnSync('pnpm', ['exec', 'eslint', '--quiet', '--format', 'json', '--config', target.config, ...target.patterns], {
		cwd,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});
	// eslint は違反があると 1、実行できないと 2 で終わる
	if (res.status !== 0 && res.status !== 1) {
		console.error(`エラー: ${target.dir} で eslint を実行できませんでした (exit status: ${res.status})`);
		console.error(res.stderr || res.error?.message || '');
		return null;
	}
	try {
		return JSON.parse(res.stdout).map(r => ({ ...r, filePath: relative(repoRoot, r.filePath) }));
	} catch {
		console.error(`エラー: ${target.dir} の eslint の出力を読めませんでした`);
		console.error(res.stderr);
		return null;
	}
}

/** 違反した行を最後に変えたコミット */
function blameLine(filePath, line) {
	const out = git(['blame', '--porcelain', '-L', `${line},${line}`, 'HEAD', '--', filePath]);
	if (out == null) return null;
	const sha = out.split('\n')[0]?.split(' ')[0];
	const summary = out.match(/^summary (.*)$/m)?.[1] ?? '';
	if (sha == null || /^0+$/.test(sha)) return null; // 未コミットの変更
	// origin/develop に含まれていれば上流のコード
	const upstream = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/develop'], { cwd: repoRoot }).status === 0;
	return { sha: sha.slice(0, 10), summary, upstream };
}

/**
 * main-統合.sh から、件名が summary の `git commit -a -m "..."` を探し、その直前の squash_merge のブランチを返す。
 * 間に別の git commit があれば (autogen の再生成など)、ブランチは特定できない
 */
function findBranch(summary) {
	if (!existsSync(integrationScript)) return null;
	const lines = readFileSync(integrationScript, 'utf8').split('\n');
	const commitIndex = lines.findIndex(l => /^\s*git commit\b/.test(l) && l.includes(`-m "${summary}"`));
	if (commitIndex === -1) return null;
	for (let i = commitIndex - 1; i >= 0; i--) {
		const squash = lines[i].match(/^\s*squash_merge\s+(\S+)/);
		if (squash) return squash[1];
		if (/^\s*git commit\b/.test(lines[i])) return null;
	}
	return null;
}

const results = [];
for (const target of targets) {
	const res = runEslint(target);
	if (res == null) process.exit(2);
	results.push(...res);
}

const violations = results.flatMap(r => r.messages.filter(m => m.severity === 2).map(m => ({ filePath: r.filePath, ...m })));
if (violations.length === 0) {
	console.log('MISTEMS lint: OK');
	process.exit(0);
}

/** ブランチ (または上流・不明) ごとにまとめる */
const groups = new Map();
for (const v of violations) {
	const blame = v.line != null ? blameLine(v.filePath, v.line) : null;
	let key;
	if (blame == null) key = '(未コミットの変更、または行を特定できない違反)';
	else if (blame.upstream) key = `(上流 origin/develop のコード: ${blame.sha} ${blame.summary})`;
	else key = findBranch(blame.summary) ?? `(ブランチを特定できない: ${blame.sha} ${blame.summary})`;
	if (!groups.has(key)) groups.set(key, []);
	groups.get(key).push({ ...v, blame });
}

console.error(`MISTEMS lint: ${violations.length} 件の違反があります。\n`);
for (const [key, list] of groups) {
	console.error(`■ ${key}`);
	for (const v of list) {
		const via = v.blame != null && !v.blame.upstream ? ` (統合のコミット ${v.blame.sha} 「${v.blame.summary}」)` : '';
		console.error(`  ${v.filePath}:${v.line}:${v.column}  [${v.ruleId ?? 'fatal'}]${via}`);
		console.error(`    ${v.message}`);
	}
	console.error('');
}

console.error(`直し方:
  - mistems-main 上では直さないこと (次の統合で消える)。
  - 「■」の行が違反を持ち込んだブランチ (main-統合.sh の squash_merge の引数) である。そのブランチの worktree に戻って直す。
    riin/release/* のときは、release を構成する元の機能ブランチで直し、rebuild-release-branch スキルで release を作り直す。
    --base 付きの squash_merge のときは、積んだ側のブランチで直す。
  - 直したら shipping-misskey-change のチェックを通してコミットし、riin に push してから、main-統合.sh を最初から実行し直す。
  - 「上流」と出たものは misskey-dev のコードなので、MISTEMS の修正ブランチを origin/develop から切って直し、main-統合.sh に足す。
  - ルールの理由と正しい書き方は、各違反のメッセージと packages/frontend/eslint.mistems.config.js のコメントにある。`);
process.exit(1);
