/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyBranch, classifyFiles, findForkPoint, slugOf } from './classify.mjs';

test('classifyFiles: migration の追加があれば migration', () => {
	const changed = [
		'packages/backend/src/core/NoteCreateService.ts',
		'packages/frontend/src/components/MkNote.vue',
		'packages/backend/migration/1780190369217-noteRenoteLock.js',
	];
	const added = ['packages/backend/migration/1780190369217-noteRenoteLock.js'];
	assert.equal(classifyFiles(changed, added), 'migration');
});

test('classifyFiles: migration の変更だけで追加が無ければ migration にしない', () => {
	const changed = ['packages/backend/migration/1000000000000-init.js', 'packages/backend/src/server/api/endpoints/meta.ts'];
	assert.equal(classifyFiles(changed, []), 'backend');
});

test('classifyFiles: migration 以外のファイルの追加は migration にしない', () => {
	const changed = ['packages/backend/src/core/NewService.ts'];
	assert.equal(classifyFiles(changed, ['packages/backend/src/core/NewService.ts']), 'backend');
});

test('classifyFiles: packages/backend/src の変更は backend', () => {
	assert.equal(classifyFiles(['packages/frontend/src/a.vue', 'packages/backend/src/b.ts'], []), 'backend');
});

test('classifyFiles: misskey-js の autogen の変更は backend', () => {
	assert.equal(classifyFiles(['packages/misskey-js/src/autogen/types.ts'], []), 'backend');
});

test('classifyFiles: misskey-js の autogen 以外や backend のテストだけなら backend にしない', () => {
	assert.equal(classifyFiles(['packages/misskey-js/src/api.ts'], []), 'other');
	assert.equal(classifyFiles(['packages/backend/test/unit/a.ts'], []), 'other');
});

test('classifyFiles: packages/frontend* だけなら frontend', () => {
	assert.equal(classifyFiles(['packages/frontend/src/pages/clip.vue'], []), 'frontend');
	assert.equal(classifyFiles(['packages/frontend/src/a.vue', 'packages/frontend-shared/js/b.ts', 'packages/frontend-embed/src/c.vue'], []), 'frontend');
});

test('classifyFiles: frontend と他のファイルが混ざれば other', () => {
	assert.equal(classifyFiles(['packages/frontend/src/a.vue', 'locales/ja-JP.yml'], []), 'other');
});

test('classifyFiles: どれでもなければ other', () => {
	assert.equal(classifyFiles(['README.md'], []), 'other');
	assert.equal(classifyFiles([], []), 'other');
});

test('findForkPoint: 件名が Version updated to: で始まる最新のコミットを返す', () => {
	const commits = [
		{ hash: 'c3', subject: 'fix: 何か' },
		{ hash: 'c2', subject: 'Version updated to: 2026.5.4-MISTEMS.91' },
		{ hash: 'c1', subject: 'Version updated to: 2026.5.4-MISTEMS.90' },
	];
	assert.equal(findForkPoint(commits), 'c2');
});

test('findForkPoint: 件名の途中にあるだけなら起点にしない', () => {
	const commits = [{ hash: 'c1', subject: 'Revert "Version updated to: 1.0"' }];
	assert.equal(findForkPoint(commits), null);
});

test('findForkPoint: 無ければ null', () => {
	assert.equal(findForkPoint([]), null);
	assert.equal(findForkPoint([{ hash: 'c1', subject: 'feat: x' }]), null);
});

test('slugOf: 最後の / 以降を小文字にし、[a-z0-9-] 以外を - にする', () => {
	assert.equal(slugOf('claude/renote-lock-feature-7J0NA'), 'renote-lock-feature-7j0na');
	assert.equal(slugOf('claude/issue-26-20260510-1119'), 'issue-26-20260510-1119');
	assert.equal(slugOf('fix-clips-pagination'), 'fix-clips-pagination');
	assert.equal(slugOf('feat/foo_bar.baz'), 'foo-bar-baz');
});

// 一時リポジトリで、差分とコミットの範囲の取り方 (三点と二点) を確かめる
function makeRepo() {
	const repo = mkdtempSync(join(tmpdir(), 'classify-test-'));
	const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
	const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env }).trim();
	const commit = (subject, files) => {
		for (const f of files) {
			mkdirSync(join(repo, dirname(f)), { recursive: true });
			writeFileSync(join(repo, f), `${subject}\n`);
		}
		git('add', '-A');
		git('commit', '-q', '--allow-empty', '-m', subject);
		return git('rev-parse', 'HEAD');
	};
	git('init', '-q', '-b', 'main');
	return { repo, git, commit };
}

test('classifyBranch: develop が後から進んだ変更は数えず、Version updated to: のコミットを起点にする', t => {
	const { repo, git, commit } = makeRepo();
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const base = commit('init', ['README.md']);
	git('checkout', '-q', '-b', 'feature');
	const version = commit('Version updated to: 2026.1.0-MISTEMS.1', ['packages/frontend/src/old.vue']);
	commit('feat: x', ['packages/frontend/src/a.vue']);
	git('checkout', '-q', 'main');
	// develop だけが backend を変えた。三点の範囲なら feature の種類に影響しない
	commit('develop: backend', ['packages/backend/src/b.ts']);
	git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
	assert.deepEqual(classifyBranch(repo, 'feature', 'claude/Feature_X'), { category: 'frontend', forkPoint: version, slug: 'feature-x' });
	assert.notEqual(version, base);
});

test('classifyBranch: Version updated to: のコミットが無ければ merge-base を起点にし、migration の追加を見分ける', t => {
	const { repo, git, commit } = makeRepo();
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const base = commit('init', ['README.md']);
	git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
	git('checkout', '-q', '-b', 'feature');
	commit('feat: migration', ['packages/backend/migration/1-a.js', 'packages/backend/src/a.ts']);
	assert.deepEqual(classifyBranch(repo, 'feature', 'feature'), { category: 'migration', forkPoint: base, slug: 'feature' });
});
