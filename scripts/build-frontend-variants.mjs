/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// frontend-variants.yml に書かれた variant をビルドし、frontend-variants/ に配置する。
// VPS のデプロイ手順で `pnpm build` の後、プロセスの再起動の前に実行する。
// 個々の variant の失敗ではデプロイを止めず、frontend-variants/_variants.json に結果（ビルド済みとスキップ）を残す。
// _variants.json の reason は公開 API で返るため、決まった文言だけにする。詳細はデプロイのログにだけ出す。
// どこで失敗しても終了コード 0 で終わる（デプロイを止めない）。
//
// 環境変数 FRONTEND_VARIANTS_NO_FETCH=1 を指定すると `git fetch origin --prune` と variant ごとの fetch を省略する（手元での検証用）。

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
const run = (cmd, args, cwd, timeout) => execFileSync(cmd, args, { cwd, stdio: 'inherit', timeout });

// 認証待ちでデプロイが固まらないよう、対話プロンプトを禁止して時間も制限する
const gitFetch = (args) => execFileSync('git', ['fetch', 'origin', ...args], {
	cwd: repoRoot,
	stdio: ['ignore', 'pipe', 'pipe'],
	env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	timeout: 120000,
});
const describeError = (e) => `${e.message}${e.stderr?.length ? `\n${e.stderr.toString().trim()}` : ''}`;

const REASON_UNEXPECTED = '予期しないエラー（デプロイのログを確認する）';
const REASON_BAD_LIST = 'frontend-variants.yml の書式が正しくない（デプロイのログを確認する）';

class SkipError extends Error {}
const skip = (reason) => { throw new SkipError(reason); };

let variants = [];
let errors = [];
let listReadFailed = false;
try {
	if (existsSync(listPath)) ({ variants, errors } = parseVariantList(readFileSync(listPath, 'utf-8')));
} catch (e) {
	console.warn(`[frontend-variants] frontend-variants.yml を読み込めない — ${describeError(e)}`);
	listReadFailed = true;
}
// 解析エラーの文言は YAML の内容を含むため、公開しない。元の文言はログにだけ出す
const skipped = errors.map((e) => {
	console.warn(`[frontend-variants] ${e.name}: 一覧の書式エラー — ${e.reason}`);
	return { name: e.name, branch: e.branch, reason: REASON_BAD_LIST };
});
if (listReadFailed) skipped.push({ name: 'frontend-variants.yml', branch: '', reason: REASON_BAD_LIST });
const built = [];
const noFetch = process.env.FRONTEND_VARIANTS_NO_FETCH === '1';

if (noFetch) {
	console.log('[frontend-variants] FRONTEND_VARIANTS_NO_FETCH=1 のため git fetch を省略する');
} else {
	try {
		gitFetch(['--prune']);
	} catch (e) {
		console.warn(`[frontend-variants] git fetch に失敗したので、手元の origin/* で続ける: ${describeError(e)}`);
	}
}

let prepared = false;
try {
	rmSync(nextRoot, { recursive: true, force: true });
	rmSync(workRoot, { recursive: true, force: true });
	// 前回の実行が途中で止まると worktree の登録だけが残り、同じパスへの worktree add が失敗するので掃除する
	try {
		git(['worktree', 'prune']);
	} catch (e) {
		console.warn(`[frontend-variants] git worktree prune に失敗した: ${describeError(e)}`);
	}
	mkdirSync(nextRoot, { recursive: true });
	mkdirSync(workRoot, { recursive: true });
	prepared = true;
} catch (e) {
	console.error(`[frontend-variants] ビルドの準備に失敗した。variant のビルドと入れ替えを省略する（デプロイは続ける）: ${describeError(e)}`);
}

for (const v of prepared ? variants : []) {
	const wt = join(workRoot, v.name);
	const remoteRef = `origin/${v.branch}`;
	console.log(`[frontend-variants] ${v.name}: ${remoteRef} (${v.mode})`);
	try {
		if (!noFetch) {
			try {
				gitFetch([`+refs/heads/${v.branch}:refs/remotes/origin/${v.branch}`]);
			} catch (e) {
				console.warn(`[frontend-variants] ${v.name}: ブランチの fetch に失敗したので、手元の ref で続ける: ${describeError(e)}`);
			}
		}

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
			run('pnpm', ['install', '--frozen-lockfile'], wt, 900000);
			run('pnpm', ['build-pre'], wt, 300000);
			run('pnpm', ['--filter', 'frontend...', 'build'], wt, 1800000);
		} catch (e) {
			console.warn(`[frontend-variants] ${v.name}: ビルドの失敗の詳細: ${describeError(e)}`);
			skip('ビルドに失敗した（デプロイのログを確認する）');
		}

		cpSync(join(wt, 'built', '_frontend_vite_'), join(nextRoot, v.name), { recursive: true });
		built.push({ name: v.name, branch: v.branch, mode: v.mode });
		console.log(`[frontend-variants] ${v.name}: OK`);
	} catch (e) {
		let reason;
		if (e instanceof SkipError) {
			reason = e.message;
		} else {
			reason = REASON_UNEXPECTED;
			console.warn(`[frontend-variants] ${v.name}: 予期しないエラーの詳細: ${describeError(e)}\n${e.stack ?? ''}`);
		}
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

if (prepared) {
	try {
		rmSync(workRoot, { recursive: true, force: true });
		try {
			git(['worktree', 'prune']);
		} catch (e) {
			console.warn(`[frontend-variants] git worktree prune に失敗した: ${describeError(e)}`);
		}
		writeFileSync(join(nextRoot, '_variants.json'), JSON.stringify({ variants: built, skipped }, null, '\t'));

		// 入れ替え。古いディレクトリは rename してから消し、配信が空になる時間を短くする
		rmSync(oldRoot, { recursive: true, force: true });
		const hadLive = existsSync(liveRoot);
		if (hadLive) renameSync(liveRoot, oldRoot);
		try {
			renameSync(nextRoot, liveRoot);
		} catch (e) {
			// 新しいものを置けなかったときは、退避した元のディレクトリを戻す
			if (hadLive) {
				try {
					renameSync(oldRoot, liveRoot);
				} catch (e2) {
					console.error(`[frontend-variants] 元の frontend-variants/ を戻せなかった。${oldRoot} に残っている: ${describeError(e2)}`);
				}
			}
			throw e;
		}
		rmSync(oldRoot, { recursive: true, force: true });
	} catch (e) {
		console.error(`[frontend-variants] 結果の配置に失敗した（デプロイは続ける）: ${describeError(e)}`);
	}
}

console.log(`[frontend-variants] 完了: ${built.length} 件ビルド, ${skipped.length} 件スキップ`);
