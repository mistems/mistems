/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// frontend-variants.yml に書かれた variant をビルドし、frontend-variants/ に配置する。
// VPS のデプロイ手順で `pnpm build` の後、プロセスの再起動の前に実行する。
// 個々の variant の失敗ではデプロイを止めず、frontend-variants/_skipped.json に理由を残す。
//
// 環境変数 FRONTEND_VARIANTS_NO_FETCH=1 を指定すると `git fetch origin --prune` を省略する（手元での検証用）。

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVariantList } from './lib/frontend-variants.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const listPath = join(repoRoot, 'frontend-variants.yml');
const workRoot = join(repoRoot, '.frontend-variants-work');
const nextRoot = join(repoRoot, 'frontend-variants.next');
const liveRoot = join(repoRoot, 'frontend-variants');
const oldRoot = join(repoRoot, 'frontend-variants.old');

const git = (args, cwd = repoRoot) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

class SkipError extends Error {}
const skip = (reason) => { throw new SkipError(reason); };

const { variants, errors } = existsSync(listPath)
	? parseVariantList(readFileSync(listPath, 'utf-8'))
	: { variants: [], errors: [] };
const skipped = [...errors];

if (process.env.FRONTEND_VARIANTS_NO_FETCH === '1') {
	console.log('[frontend-variants] FRONTEND_VARIANTS_NO_FETCH=1 のため git fetch を省略する');
} else {
	try {
		// 認証待ちでデプロイが固まらないよう、対話プロンプトを禁止して時間も制限する
		execFileSync('git', ['fetch', 'origin', '--prune'], {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
			timeout: 120000,
		});
	} catch (e) {
		console.warn(`[frontend-variants] git fetch に失敗したので、手元の origin/* で続ける: ${e.message}`);
	}
}

rmSync(nextRoot, { recursive: true, force: true });
rmSync(workRoot, { recursive: true, force: true });
// 前回の実行が途中で止まると worktree の登録だけが残り、同じパスへの worktree add が失敗するので掃除する
try {
	git(['worktree', 'prune']);
} catch (e) {
	console.warn(`[frontend-variants] git worktree prune に失敗した: ${e.message}`);
}
mkdirSync(nextRoot, { recursive: true });
mkdirSync(workRoot, { recursive: true });

for (const v of variants) {
	const wt = join(workRoot, v.name);
	const remoteRef = `origin/${v.branch}`;
	console.log(`[frontend-variants] ${v.name}: ${remoteRef} (${v.mode})`);
	try {
		try {
			git(['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]);
		} catch {
			skip(`${remoteRef} が見つからない（push 済みか確認する）`);
		}

		if (v.mode === 'as-is') {
			git(['worktree', 'add', '--detach', wt, remoteRef]);
		} else {
			git(['worktree', 'add', '--detach', wt, 'HEAD']);
			try {
				git(['merge-base', 'HEAD', remoteRef]);
			} catch {
				skip(git(['rev-parse', '--is-shallow-repository']) === 'true'
					? 'shallow clone のため HEAD に取り込めない（git fetch --unshallow する）'
					: 'HEAD と共通の祖先がない');
			}
			try {
				git(['merge', '--squash', remoteRef], wt);
			} catch {
				skip('HEAD への取り込みでコンフリクトした（統合確認ブランチを作って mode: as-is で載せる）');
			}
		}

		try {
			run('pnpm', ['install', '--frozen-lockfile'], wt);
			run('pnpm', ['build-pre'], wt);
			run('pnpm', ['--filter', 'frontend...', 'build'], wt);
		} catch {
			skip('ビルドに失敗した（ログを確認する）');
		}

		cpSync(join(wt, 'built', '_frontend_vite_'), join(nextRoot, v.name), { recursive: true });
		console.log(`[frontend-variants] ${v.name}: OK`);
	} catch (e) {
		const reason = e instanceof SkipError ? e.message : `予期しないエラー: ${e.message}`;
		console.warn(`[frontend-variants] ${v.name}: スキップ — ${reason}`);
		skipped.push({ name: v.name, branch: v.branch, reason });
	} finally {
		try {
			git(['worktree', 'remove', '--force', wt]);
		} catch {
			// worktree add の前に失敗した場合は何もしない
		}
	}
}

rmSync(workRoot, { recursive: true, force: true });
try {
	git(['worktree', 'prune']);
} catch (e) {
	console.warn(`[frontend-variants] git worktree prune に失敗した: ${e.message}`);
}
writeFileSync(join(nextRoot, '_skipped.json'), JSON.stringify(skipped, null, '\t'));

// 入れ替え。古いディレクトリは rename してから消し、配信が空になる時間を短くする
rmSync(oldRoot, { recursive: true, force: true });
if (existsSync(liveRoot)) renameSync(liveRoot, oldRoot);
renameSync(nextRoot, liveRoot);
rmSync(oldRoot, { recursive: true, force: true });

console.log(`[frontend-variants] 完了: ${variants.length - (skipped.length - errors.length)} 件ビルド, ${skipped.length} 件スキップ`);
