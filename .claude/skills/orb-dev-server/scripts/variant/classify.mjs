/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// variant (統合待ちのブランチを個別のコンテナで動かす環境) のための、ブランチの判定。
//
// usage:
//   node classify.mjs <repo> <branch-ref>  {"category":…,"forkPoint":…,"slug":…} を出力する
//   node classify.mjs --slug <branch>      variant の名前 (slug) だけを出力する (git を使わない)
//
// category は origin/develop との差分 (merge-base からブランチ先端まで) で決める。
// forkPoint は、ブランチ固有の差分を取り出す起点のコミットである。

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MIGRATION_DIR = 'packages/backend/migration/';
const BACKEND_PREFIXES = ['packages/backend/src/', 'packages/misskey-js/src/autogen/'];
const FRONTEND_PREFIX = 'packages/frontend';
const FORK_POINT_SUBJECT = 'Version updated to:';

/**
 * 変更ファイルの一覧から、variant の種類を返す。
 * @param {string[]} changedPaths 変更されたファイル (追加・変更・削除をすべて含む)
 * @param {string[]} addedPaths そのうち追加されたファイル
 * @returns {'migration' | 'backend' | 'frontend' | 'other'}
 */
export function classifyFiles(changedPaths, addedPaths) {
	if (addedPaths.some(p => p.startsWith(MIGRATION_DIR))) return 'migration';
	if (changedPaths.some(p => BACKEND_PREFIXES.some(prefix => p.startsWith(prefix)))) return 'backend';
	if (changedPaths.length > 0 && changedPaths.every(p => p.startsWith(FRONTEND_PREFIX))) return 'frontend';
	return 'other';
}

/**
 * origin/develop..<branch> のコミット (新しい順) から、件名が "Version updated to:" で始まる最新のコミットを返す。
 * 古い mistems-main から派生したブランチで、ブランチ固有のコミットだけを取り出す起点に使う。
 * @param {{ hash: string, subject: string }[]} commits
 * @returns {string | null} コミットのハッシュ。無ければ null
 */
export function findForkPoint(commits) {
	const found = commits.find(c => c.subject.startsWith(FORK_POINT_SUBJECT));
	return found ? found.hash : null;
}

/**
 * ブランチ名から variant の名前を作る。最後の / 以降を小文字にし、[a-z0-9-] 以外を - にする。
 * @param {string} branch
 * @returns {string}
 */
export function slugOf(branch) {
	return branch.slice(branch.lastIndexOf('/') + 1).toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function git(repo, args) {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function lines(text) {
	return text.split('\n').filter(l => l !== '');
}

/**
 * @param {string} repo
 * @param {string} branchRef 例: riin/claude/renote-lock-feature-7J0NA
 * @param {string} branch slug に使うブランチ名
 */
export function classifyBranch(repo, branchRef, branch) {
	const range = `origin/develop...${branchRef}`;
	const changed = lines(git(repo, ['diff', '--no-renames', '--name-only', range]));
	const added = lines(git(repo, ['diff', '--no-renames', '--name-only', '--diff-filter=A', range]));
	const commits = lines(git(repo, ['log', '--format=%H%x09%s', `origin/develop..${branchRef}`])).map(l => {
		const tab = l.indexOf('\t');
		return { hash: l.slice(0, tab), subject: l.slice(tab + 1) };
	});
	const forkPoint = findForkPoint(commits) ?? git(repo, ['merge-base', 'origin/develop', branchRef]).trim();
	return { category: classifyFiles(changed, added), forkPoint, slug: slugOf(branch) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	if (args[0] === '--slug' && args.length === 2) {
		console.log(slugOf(args[1]));
	} else if (args.length === 2 && !args[0].startsWith('-')) {
		const [repo, branchRef] = args;
		// riin/claude/foo のようなリモートの ref でも、slug はブランチ名の最後の / 以降から作るので同じになる
		console.log(JSON.stringify(classifyBranch(repo, branchRef, branchRef)));
	} else {
		console.error('usage: node classify.mjs <repo> <branch-ref> | node classify.mjs --slug <branch>');
		process.exit(1);
	}
}
