# フロントエンド variant 切り替え Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 複数ブランチのフロントエンドビルドを 1 つの本番インスタンスに同居させ、Cookie でブラウザごとに表示する variant を切り替えられるようにする。

**Architecture:** Vite の出力ファイルはハッシュ付きの名前なので、別ブランチのビルドを `/vite/` 配下に並べても衝突しない。ブランチごとに違うのは `manifest.json` と `loader/boot.js` だけである。そこで backend の `HtmlTemplateService` が Cookie `mk_fe_variant` を見て、HTML に埋め込む manifest とブートローダーを variant のものに差し替える。`/vite/` の静的配信は本線のディレクトリと各 variant のディレクトリを順に探す。

**Tech Stack:** NestJS + Fastify（`@fastify/static` 10.1.3 の複数 root 機能）、@kitajs/html（JSX テンプレート）、Vite（rolldown）、vitest

**Spec:** 独立した仕様書はない。下の「設計」節が仕様を兼ねる（会話で合意した案A）。

## 設計

### ディレクトリ構成

```
<repoRoot>/
  frontend-variants.yml              ← 新設。mistems-main にコミットする variant の一覧
  built/_frontend_vite_/             ← 本線（今まで通り）
  frontend-variants/                 ← 新設。サーバーでのビルド時に生成する。git 管理外
    _skipped.json                    ← ビルドできなかった variant と理由
    feat-foo/                        ← variant 名 = ディレクトリ名
      manifest.json
      loader/boot.js
      loader/style.css
      scripts/... assets/... ja-JP/... （その variant の _frontend_vite_ 一式）
```

- variant 名は `^[a-zA-Z0-9_-]{1,64}$` に一致するものだけを有効とする（パストラバーサル対策）
- `manifest.json` を含まないディレクトリは、ビルド途中で失敗したものとみなして無視する
- variant の一覧はプロセス起動時に 1 回だけ読む。variant を追加・削除したら再起動する

### variant の一覧ファイル

```yaml
# frontend-variants.yml
- name: emoji-drop                   # variant 名。/__fe とバッジに出る
  branch: riin/feat/emoji-drop-area  # origin にある機能ブランチ
- name: timeline-check
  branch: riin/check/timeline        # 統合確認ブランチ
  mode: as-is                        # HEAD に足さず、ブランチをそのままビルドする
```

- `mode` を省略すると `merge` とみなす。`merge` は「HEAD（mistems-main）に `git merge --squash origin/<branch>` したもの」をビルドする。`main-統合.sh` と同じ取り込み方である
- `as-is` は `origin/<branch>` をそのままビルドする。単独の取り込みでコンフリクトするときは、統合確認ブランチを作って `as-is` で載せる
- 一覧から消した variant は、次のデプロイで自動的に消える

### variant のビルド（VPS 上で、デプロイ手順の中で行う）

ブランチは Mac で作って push し、ビルドは VPS 上で行う（Docker は使わない）。

1. VPS のデプロイ手順で、`pnpm build` の後、プロセスの再起動の前に `node scripts/build-frontend-variants.mjs` を 1 行足す
2. スクリプトは最初に `git fetch origin --prune` を実行する。fetch に失敗したら警告を出し、手元にある `origin/*` で続ける
3. variant ごとに一時 worktree（`<repoRoot>/.frontend-variants-work/<name>/`）を作り、ブランチの取り込み、`pnpm install --frozen-lockfile`、フロントエンドのビルドを行う。成果物は `frontend-variants.next/<name>/` に置く
4. コンフリクト、ブランチが見つからない、ビルドの失敗のどれかが起きたら、その variant はスキップして `_skipped.json` に記録し、残りの variant を続ける。スクリプトは終了コード 0 で終わり、**デプロイ自体は止めない**
5. 全部終わったら `frontend-variants/` を `frontend-variants.next/` と入れ替える（古い方は削除する）。入れ替えるまでは、動いているプロセスが古い variant を配信し続ける
6. 一時 worktree は成功・失敗にかかわらず削除する

ビルド時間は variant 1 つにつき、`pnpm install` とフロントエンドのビルド 1 回分（数分）ずつ増える。ディスクも、一時 worktree の `node_modules` の分だけビルド中に一時的に使う。

### リクエストの流れ

1. 利用者が `/__fe` を開き、variant の一覧から 1 つ選ぶ → `/__fe/switch?v=feat-foo`。一覧の下には、スキップされた variant と理由も表示する
2. `/__fe/switch` は Cookie `mk_fe_variant=feat-foo`（7 日間）を付けて `/` にリダイレクトする。`v` が空なら Cookie を消す
3. HTML を返すとき、`HtmlTemplateService.getCommonData(cookieHeader)` が Cookie から variant を選び、その variant の `ViteFiles`・`boot.js`・`style.css` を返す
4. ブラウザは `/vite/scripts/<hash>.js` などを取りに来る。`@fastify/static` は本線 → 各 variant の順にファイルを探す
5. variant 表示中は画面左下にバッジを出す。クリックすると `/__fe/switch`（Cookie を消す）に飛ぶ
6. variant 表示中の HTML には `Cache-Control: private, no-store` を付け、共有キャッシュに載らないようにする

### 対象外

- 埋め込み用フロントエンド（`frontend-embed`、`/embed_vite/`）は切り替えない
- backend の変更を含むブランチは確認できない。variant が呼ぶ API は本番の backend に存在する必要がある
- アクセス制限はかけない。URL を知っていれば誰でも切り替えられるが、見た目が変わるだけで権限は変わらない

## Global Constraints

- 作業ブランチは `origin/develop` から新規に切る（例: `riin/feat/frontend-variants`）。mistems-main へは従来どおり `main-統合.sh` で取り込む
- `packages/backend/` を編集する前に `working-on-backend` スキルを参照する
- commit 前に `shipping-misskey-change` スキルを参照する
- 新規の `.ts` / `.mjs` には SPDX ヘッダーを付け、`node scripts/check-spdx.mjs` が `SPDX: OK` を返すことを確認する
- `locales/*.yml` は編集しない。バッジや一覧ページは開発者向けなので文字列は直書きとする
- variant 名の検証は `^[a-zA-Z0-9_-]{1,64}$` で行い、backend と build スクリプトで同じ正規表現を使う
- Cookie 名は `mk_fe_variant`、有効期間は 604800 秒（7 日）、属性は `Path=/; SameSite=Lax`、`config.url` が `https://` で始まるときは `Secure` も付ける
- backend のテストは `.config/test.yml` が必要（`cp .github/misskey/test.yml .config/test.yml`）

## Review Focus

1. **デプロイ後に消えた variant の Cookie を持ったまま来た** → 本線を表示し、バッジは出さない（Task 1 の `pickVariant` のテストで確認する）
2. **Cookie やクエリに `../` などの不正な名前が入っている** → variant として扱わず本線を表示する。`/__fe/switch` は 404 を返す（Task 1 のテストで確認する）
3. **Cloudflare などの共有キャッシュが variant の HTML を他人に配る** → variant 表示中の HTML は `private, no-store` にする（Task 3 の手動確認で Cache-Control ヘッダーを見る）。逆に、本線の HTML が共有キャッシュから variant 利用者に返る可能性は残るので、CDN 側で `mk_fe_variant` Cookie があるリクエストのキャッシュを迂回する設定を docs/frontend-variants.md に書く
4. **Cookie ヘッダーが壊れている**（`=` がない、同名が重複している、前後に空白がある） → 例外を出さず、最初に見つかった値を使う（Task 1 のテストで確認する）
5. **ビルドが途中で失敗して `manifest.json` がない variant ディレクトリ** → 一覧に出さない（Task 1 の `listVariants` のテストで確認する）
6. **サーバーの clone が shallow で、merge-base が見つからない** → その variant を「shallow clone のため取り込めない」理由でスキップし、ビルドは続ける（Task 6 の Step 4 で確認する）
7. **`_skipped.json` が壊れている、または存在しない** → `/__fe` は空のスキップ一覧として表示し、例外を出さない（Task 1 の `readSkippedVariants` のテストで確認する）

---

### Task 1: variant 判定の純粋関数

**Files:**
- Create: `packages/backend/src/server/web/frontend-variant.ts`
- Test: `packages/backend/test/unit/server/frontend-variant.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export const FRONTEND_VARIANT_COOKIE = 'mk_fe_variant'`
  - `export function isValidVariantName(name: string): boolean`
  - `export function parseVariantCookie(cookieHeader: string | undefined): string | null`
  - `export function pickVariant(cookieHeader: string | undefined, available: readonly string[]): string | null`
  - `export function listVariants(variantsRoot: string): string[]`（同期 API。起動時にだけ呼ぶ）
  - `export function buildVariantCookie(name: string | null, secure: boolean): string`
  - `export type SkippedVariant = { name: string; branch: string; reason: string }`
  - `export function readSkippedVariants(variantsRoot: string): SkippedVariant[]`（`<variantsRoot>/_skipped.json` を読む。ない・壊れている・形が違うときは空配列）

- [ ] **Step 1: 失敗するテストを書く**

```ts
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
	readSkippedVariants,
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

describe('readSkippedVariants', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'fe-variants-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('ファイルがなければ空配列', () => {
		expect(readSkippedVariants(root)).toEqual([]);
	});
	test('JSON が壊れていたら空配列', () => {
		writeFileSync(join(root, '_skipped.json'), '{broken');
		expect(readSkippedVariants(root)).toEqual([]);
	});
	test('配列でなければ空配列', () => {
		writeFileSync(join(root, '_skipped.json'), '{"name":"x"}');
		expect(readSkippedVariants(root)).toEqual([]);
	});
	test('形の正しい要素だけを返す', () => {
		writeFileSync(join(root, '_skipped.json'), JSON.stringify([
			{ name: 'a', branch: 'riin/feat/a', reason: 'conflict' },
			{ name: 'b' },
			'garbage',
		]));
		expect(readSkippedVariants(root)).toEqual([{ name: 'a', branch: 'riin/feat/a', reason: 'conflict' }]);
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test test/unit/server/frontend-variant.ts`
Expected: FAIL（`@/server/web/frontend-variant.js` が見つからない）

- [ ] **Step 3: 実装する**

```ts
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FRONTEND_VARIANT_COOKIE = 'mk_fe_variant';

const VARIANT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function isValidVariantName(name: string): boolean {
	return VARIANT_NAME_RE.test(name);
}

export function parseVariantCookie(cookieHeader: string | undefined): string | null {
	if (cookieHeader == null) return null;
	for (const part of cookieHeader.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== FRONTEND_VARIANT_COOKIE) continue;
		const value = part.slice(eq + 1).trim();
		return isValidVariantName(value) ? value : null;
	}
	return null;
}

export function pickVariant(cookieHeader: string | undefined, available: readonly string[]): string | null {
	const name = parseVariantCookie(cookieHeader);
	return name != null && available.includes(name) ? name : null;
}

export function listVariants(variantsRoot: string): string[] {
	if (!existsSync(variantsRoot)) return [];
	return readdirSync(variantsRoot, { withFileTypes: true })
		.filter(d => d.isDirectory() && isValidVariantName(d.name))
		.filter(d => existsSync(join(variantsRoot, d.name, 'manifest.json')))
		.map(d => d.name)
		.sort();
}

export function buildVariantCookie(name: string | null, secure: boolean): string {
	const attrs = [
		`${FRONTEND_VARIANT_COOKIE}=${name ?? ''}`,
		'Path=/',
		`Max-Age=${name != null ? COOKIE_MAX_AGE_SEC : 0}`,
		'SameSite=Lax',
	];
	if (secure) attrs.push('Secure');
	return attrs.join('; ');
}

export type SkippedVariant = {
	name: string;
	branch: string;
	reason: string;
};

function isSkippedVariant(x: unknown): x is SkippedVariant {
	if (typeof x !== 'object' || x == null) return false;
	const o = x as Record<string, unknown>;
	return typeof o.name === 'string' && typeof o.branch === 'string' && typeof o.reason === 'string';
}

export function readSkippedVariants(variantsRoot: string): SkippedVariant[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(join(variantsRoot, '_skipped.json'), 'utf-8'));
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(isSkippedVariant).map(({ name, branch, reason }) => ({ name, branch, reason }));
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test test/unit/server/frontend-variant.ts`
Expected: PASS

- [ ] **Step 5: lint して commit する**

```bash
pnpm --filter backend exec eslint --quiet src/server/web/frontend-variant.ts test/unit/server/frontend-variant.ts
git add packages/backend/src/server/web/frontend-variant.ts packages/backend/test/unit/server/frontend-variant.ts
git commit -m "feat(backend): フロントエンド variant 判定用の関数を追加"
```

---

### Task 2: HtmlTemplateService を variant ごとのアセットに対応させる

**Files:**
- Modify: `packages/backend/src/server/web/HtmlTemplateService.ts`（`prepareFrontendAssets` と `getCommonData`）
- Modify: `packages/backend/src/server/web/views/_.ts:33-53`（`CommonData` 型）

**Interfaces:**
- Consumes: Task 1 の `listVariants`、`pickVariant`
- Produces:
  - `HtmlTemplateService.getCommonData(cookieHeader?: string): Promise<CommonData>`
  - `HtmlTemplateService.resolveVariant(cookieHeader: string | undefined): string | null`（`prepareFrontendAssets` 後に正しい値を返す。前なら常に null）
  - `HtmlTemplateService.getAvailableVariants(): Promise<string[]>`
  - `HtmlTemplateService.frontendVariantsRoot: string`（`<rootDir>/frontend-variants`、public readonly）
  - `CommonData.frontendVariant: string | null`

- [ ] **Step 1: `CommonData` に `frontendVariant` を足す**

`views/_.ts` の `CommonData` 型の `frontendEmbedBootloaderCss: string | null;` の次の行に追加する。

```ts
	/** 表示中のフロントエンド variant 名。本線なら null */
	frontendVariant: string | null;
```

- [ ] **Step 2: HtmlTemplateService に variant 用のフィールドと読み込み処理を足す**

import に追加する。

```ts
import { listVariants, pickVariant } from './frontend-variant.js';
```

クラスのフィールドとコンストラクタに追加する。

```ts
type FrontendAssets = {
	viteFiles: ViteFiles | null;
	bootloaderJs: string | null;
	bootloaderCss: string | null;
};
```

（↑ はクラス定義の直前、ファイルスコープに置く）

```ts
	public readonly frontendVariantsRoot: string;
	private readonly variantAssets = new Map<string, FrontendAssets>();
```

```ts
		// constructor の末尾
		this.frontendVariantsRoot = resolve(this.config.rootDir, 'frontend-variants');
```

private メソッドを追加する。

```ts
	@bindThis
	private async loadVariantAssets(dir: string): Promise<FrontendAssets> {
		const [bootloaderJs, bootloaderCss, manifestContent] = await Promise.all([
			fsp.readFile(resolve(dir, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(dir, 'loader/style.css'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(dir, 'manifest.json'), 'utf-8').catch(() => null),
		]);
		const manifest = manifestContent != null ? JSON.parse(manifestContent) as Manifest : null;
		return {
			viteFiles: manifest != null ? this.collectViteAssetFiles(manifest) : null,
			bootloaderJs,
			bootloaderCss,
		};
	}
```

`prepareFrontendAssets` の末尾（`embedBootCss` の代入の後）に追加する。

```ts
		for (const name of listVariants(this.frontendVariantsRoot)) {
			this.variantAssets.set(name, await this.loadVariantAssets(resolve(this.frontendVariantsRoot, name)));
		}
```

- [ ] **Step 3: public メソッドを追加し、`getCommonData` を変える**

```ts
	@bindThis
	public resolveVariant(cookieHeader: string | undefined): string | null {
		return pickVariant(cookieHeader, [...this.variantAssets.keys()]);
	}

	@bindThis
	public async getAvailableVariants(): Promise<string[]> {
		await this.prepareFrontendAssets();
		return [...this.variantAssets.keys()];
	}
```

`getCommonData` のシグネチャと、フロントエンド関連の 3 項目を次のように変える。

```ts
	@bindThis
	public async getCommonData(cookieHeader?: string): Promise<CommonData> {
		await this.prepareFrontendAssets();

		const variant = this.resolveVariant(cookieHeader);
		const variantAssets = variant != null ? this.variantAssets.get(variant) : undefined;

		return {
			// ...（既存の項目はそのまま）
			frontendViteFiles: variantAssets?.viteFiles ?? this.frontendViteFiles,
			frontendBootloaderJs: variantAssets?.bootloaderJs ?? this.frontendBootloaderJs,
			frontendBootloaderCss: variantAssets?.bootloaderCss ?? this.frontendBootloaderCss,
			// embed 系 3 項目はそのまま
			frontendVariant: variantAssets != null ? variant : null,
		};
	}
```

- [ ] **Step 4: 型チェックと lint を実行する**

Run: `pnpm --filter backend typecheck && pnpm --filter backend exec eslint --quiet src/server/web/HtmlTemplateService.ts src/server/web/views/_.ts`
Expected: エラーなし（この時点では呼び出し側は引数なしのままなので、本線が返る）

- [ ] **Step 5: commit する**

```bash
git add packages/backend/src/server/web/HtmlTemplateService.ts packages/backend/src/server/web/views/_.ts
git commit -m "feat(backend): HTML テンプレートで Cookie に応じたフロントエンド variant を選べるように"
```

---

### Task 3: ClientServerService に配信・切り替え・キャッシュ制御を入れる

**Files:**
- Modify: `packages/backend/src/server/web/ClientServerService.ts`
  - `/vite/` の `fastifyStatic` 登録（216-222 行付近）
  - `getCommonData()` の呼び出し 15 か所（444 行以降）
  - 切り替え用ルートと onSend フックの追加

**Interfaces:**
- Consumes: Task 1 の `isValidVariantName`、`buildVariantCookie`、`readSkippedVariants`、Task 2 の `getCommonData(cookieHeader)`、`resolveVariant`、`getAvailableVariants`、`frontendVariantsRoot`、`listVariants`
- Produces: HTTP ルート `GET /__fe`、`GET /__fe/switch?v=<name>`

- [ ] **Step 1: `/vite/` の配信を複数 root にする**

import に追加する。

```ts
import { escapeHtml } from '@kitajs/html';
import { buildVariantCookie, isValidVariantName, listVariants, readSkippedVariants } from './frontend-variant.js';
```

`@kitajs/html` が `escapeHtml` を export していなければ、`frontend-variant.ts` に `&`・`<`・`>`・`"`・`'` を置き換える `escapeHtml(s: string): string` を足して使う。

`prefix: '/vite/'` の `fastifyStatic` 登録の `root` を次に変える。本線が先頭なので、ハッシュなしのファイル（`loader/boot.js` など）は本線のものが返る。

```ts
					root: [
						this.frontendViteOut,
						...listVariants(this.htmlTemplateService.frontendVariantsRoot)
							.map(name => resolve(this.htmlTemplateService.frontendVariantsRoot, name)),
					],
```

- [ ] **Step 2: `getCommonData()` に Cookie を渡す**

ファイル内の `this.htmlTemplateService.getCommonData()` をすべて `this.htmlTemplateService.getCommonData(reply.request.headers.cookie)` に置き換える。置き換え後、`grep -n "getCommonData()" packages/backend/src/server/web/ClientServerService.ts` が何も出さないことを確認する。`reply` がスコープにない呼び出し箇所があれば、その関数の引数から `reply` か `request` を渡す。

- [ ] **Step 3: variant 表示中の HTML を共有キャッシュから外す**

`createServer` 内、ルート登録より前に追加する。

```ts
		fastify.addHook('onSend', async (request, reply, payload) => {
			const contentType = String(reply.getHeader('Content-Type') ?? '');
			if (contentType.startsWith('text/html') && this.htmlTemplateService.resolveVariant(request.headers.cookie) != null) {
				reply.header('Cache-Control', 'private, no-store');
			}
			return payload;
		});
```

- [ ] **Step 4: 切り替え用のルートを追加する**

`renderBase` の定義より前に追加する。variant 名は `isValidVariantName` を通っているので HTML にそのまま埋め込めるが、スキップ一覧のブランチ名と理由はビルドスクリプトが書いた任意の文字列なので `escapeHtml` を通す。

```ts
		//#region frontend variants
		fastify.get('/__fe', async (request, reply) => {
			const variants = await this.htmlTemplateService.getAvailableVariants();
			const current = this.htmlTemplateService.resolveVariant(request.headers.cookie);
			const items = variants.map(name => `<li><a href="/__fe/switch?v=${name}">${name}</a>${name === current ? '（表示中）' : ''}</li>`).join('');
			const skipped = readSkippedVariants(this.htmlTemplateService.frontendVariantsRoot)
				.map(s => `<li>${escapeHtml(s.name)}（${escapeHtml(s.branch)}）: ${escapeHtml(s.reason)}</li>`).join('');
			reply.header('Cache-Control', 'private, no-store');
			reply.header('Content-Type', 'text/html; charset=utf-8');
			return `<!doctype html><meta charset="utf-8"><title>Frontend variants</title><h1>Frontend variants</h1><ul><li><a href="/__fe/switch">本線に戻す</a>${current == null ? '（表示中）' : ''}</li>${items}</ul>${skipped !== '' ? `<h2>ビルドできなかった variant</h2><ul>${skipped}</ul>` : ''}`;
		});

		fastify.get<{ Querystring: { v?: string } }>('/__fe/switch', async (request, reply) => {
			const v = request.query.v ?? '';
			const secure = this.config.url.startsWith('https://');
			if (v === '') {
				reply.header('Set-Cookie', buildVariantCookie(null, secure));
			} else if (isValidVariantName(v) && (await this.htmlTemplateService.getAvailableVariants()).includes(v)) {
				reply.header('Set-Cookie', buildVariantCookie(v, secure));
			} else {
				reply.code(404);
				return 'unknown variant';
			}
			reply.header('Cache-Control', 'private, no-store');
			return reply.redirect('/');
		});
		//#endregion
```

- [ ] **Step 5: 型チェックと lint を実行して commit する**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint --quiet src/server/web/ClientServerService.ts
git add packages/backend/src/server/web/ClientServerService.ts
git commit -m "feat(backend): /__fe でフロントエンド variant を切り替えられるように"
```

---

### Task 4: variant 表示中のバッジ

**Files:**
- Modify: `packages/backend/src/server/web/views/base.tsx`（`<body>` 内、`{props.children}` の直後）

**Interfaces:**
- Consumes: Task 2 の `CommonData.frontendVariant`
- Produces: なし

- [ ] **Step 1: バッジを追加する**

`{props.children}` の直後に追加する。Vue アプリは `#misskey_app` にマウントされるので、`body` 直下のこの要素は残る。

```tsx
					{props.frontendVariant != null ? (
						<a
							href="/__fe/switch"
							title="クリックで本線に戻す"
							style="position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border-radius:6px;background:#e5484d;color:#fff;font:12px/1.4 sans-serif;text-decoration:none;"
						>
							FE: {props.frontendVariant} ✕
						</a>
					) : null}
```

`{props.frontendVariant}` は `<a>` の子要素なので @kitajs/html がエスケープする。ただし @kitajs/html の lint ルール（`safe` 属性の要求）で警告が出たら、`<span safe>{props.frontendVariant}</span>` で囲む。

- [ ] **Step 2: 型チェックと lint を実行して commit する**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint --quiet src/server/web/views/base.tsx
git add packages/backend/src/server/web/views/base.tsx
git commit -m "feat(backend): フロントエンド variant 表示中にバッジを出す"
```

---


### Task 5: 一覧ファイルの読み込み（純粋関数）

**Files:**
- Create: `scripts/lib/frontend-variants.mjs`
- Test: `scripts/lib/frontend-variants.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export function parseVariantList(yamlText: string): { variants: VariantEntry[]; errors: SkippedVariant[] }`
  - `VariantEntry = { name: string; branch: string; mode: 'merge' | 'as-is' }`
  - `SkippedVariant = { name: string; branch: string; reason: string }`（backend の `SkippedVariant` と同じ形。`_skipped.json` にそのまま書く）

- [ ] **Step 1: 失敗するテストを書く**

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/lib/frontend-variants.test.mjs`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 実装する**

```js
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { load as loadYaml } from 'js-yaml';

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
	let doc;
	try {
		doc = loadYaml(yamlText);
	} catch (e) {
		return { variants: [], errors: [{ name: '(全体)', branch: '', reason: `frontend-variants.yml を読めない: ${e.message}` }] };
	}
	if (doc == null) return { variants: [], errors: [] };
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test scripts/lib/frontend-variants.test.mjs`
Expected: PASS

- [ ] **Step 5: commit する**

```bash
git add scripts/lib/frontend-variants.mjs scripts/lib/frontend-variants.test.mjs
git commit -m "feat: frontend-variants.yml を検証する関数を追加"
```

---

### Task 6: variant をまとめてビルドするスクリプト

**Files:**
- Create: `scripts/build-frontend-variants.mjs`
- Create: `frontend-variants.yml`（空の一覧とコメントだけ）
- Modify: `.gitignore`（`/frontend-variants/`、`/frontend-variants.next/`、`/frontend-variants.old/`、`/.frontend-variants-work/` を追加）

**Interfaces:**
- Consumes: Task 5 の `parseVariantList`
- Produces: `node scripts/build-frontend-variants.mjs`（引数なし）→ `frontend-variants/<name>/` と `frontend-variants/_skipped.json`。終了コードは常に 0（一覧ファイルがなくても 0）

- [ ] **Step 1: 一覧ファイルの雛形を作る**

```yaml
# 本番に同居させるフロントエンド variant の一覧。
# サーバーでのデプロイ時に scripts/build-frontend-variants.mjs がビルドする。
# 切り替えは /__fe から行う。詳しくは docs/frontend-variants.md を参照。
#
# - name: emoji-drop                   # variant 名（英数字・ハイフン・アンダースコア）
#   branch: riin/feat/emoji-drop-area  # origin にあるブランチ
#   mode: merge                        # merge（既定）: HEAD に squash merge してビルド / as-is: ブランチをそのままビルド
[]
```

- [ ] **Step 2: スクリプトを書く**

```js
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// frontend-variants.yml に書かれた variant をビルドし、frontend-variants/ に配置する。
// VPS のデプロイ手順で `pnpm build` の後、プロセスの再起動の前に実行する。
// 個々の variant の失敗ではデプロイを止めず、frontend-variants/_skipped.json に理由を残す。

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

try {
	git(['fetch', 'origin', '--prune']);
} catch (e) {
	console.warn(`[frontend-variants] git fetch に失敗したので、手元の origin/* で続ける: ${e.message}`);
}

rmSync(nextRoot, { recursive: true, force: true });
rmSync(workRoot, { recursive: true, force: true });
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
git(['worktree', 'prune']);
writeFileSync(join(nextRoot, '_skipped.json'), JSON.stringify(skipped, null, '\t'));

// 入れ替え。古いディレクトリは rename してから消し、配信が空になる時間を短くする
rmSync(oldRoot, { recursive: true, force: true });
if (existsSync(liveRoot)) renameSync(liveRoot, oldRoot);
renameSync(nextRoot, liveRoot);
rmSync(oldRoot, { recursive: true, force: true });

console.log(`[frontend-variants] 完了: ${variants.length - (skipped.length - errors.length)} 件ビルド, ${skipped.length} 件スキップ`);
```

- [ ] **Step 3: `.gitignore` に追加する**

```
/frontend-variants/
/frontend-variants.next/
/frontend-variants.old/
/.frontend-variants-work/
```

- [ ] **Step 4: 手元で動きを確かめる**

一覧が空のとき:
Run: `node scripts/build-frontend-variants.mjs && cat frontend-variants/_skipped.json`
Expected: `[]` が表示され、終了コード 0

一覧に「存在しないブランチ」「コンフリクトするブランチ」「通るブランチ」を 1 つずつ書いたとき（確認後に一覧は元に戻す）:
Run: `node scripts/build-frontend-variants.mjs; echo "exit=$?"; ls frontend-variants; cat frontend-variants/_skipped.json; git worktree list`
Expected: `exit=0`。通ったブランチのディレクトリに `manifest.json` があり、`_skipped.json` に残り 2 件が理由つきで記録される。`git worktree list` に一時 worktree が残っていない

shallow clone のとき:
Run: `git clone --depth 1 file://$PWD /tmp/fe-shallow && cp frontend-variants.yml /tmp/fe-shallow/ && (cd /tmp/fe-shallow && node scripts/build-frontend-variants.mjs) ; cat /tmp/fe-shallow/frontend-variants/_skipped.json; rm -rf /tmp/fe-shallow`
Expected: merge モードの variant が「shallow clone のため」でスキップされる（`--depth 1` の clone では `origin/*` が 1 本しかないので、確認用ブランチを `git -C /tmp/fe-shallow fetch --depth 1 origin <branch>:refs/remotes/origin/<branch>` で入れておく）

- [ ] **Step 5: SPDX を確認して commit する**

```bash
node scripts/check-spdx.mjs
git add scripts/build-frontend-variants.mjs frontend-variants.yml .gitignore
git commit -m "feat: frontend-variants.yml の variant をまとめてビルドするスクリプトを追加"
```

---

### Task 7: 本番ビルドでの通し確認と運用手順

**Files:**
- Create: `docs/frontend-variants.md`（運用手順）

**Interfaces:**
- Consumes: Task 1〜6 のすべて
- Produces: なし

- [ ] **Step 1: 見た目の違う variant を用意する**

確認用に、develop から一時ブランチを切り、`packages/frontend/src/ui/universal.vue` の背景色を変えて commit する。このブランチは push しないので、ローカルで `git update-ref refs/remotes/origin/tmp/fe-check <そのコミット>` として `origin/*` に見せかける（確認後に `git update-ref -d refs/remotes/origin/tmp/fe-check` で消す）。`frontend-variants.yml` に `name: check`、`branch: tmp/fe-check`、`mode: as-is` を書く（確認後に元に戻す）。

Run: `node scripts/build-frontend-variants.mjs`

- [ ] **Step 2: 本番ビルドで起動する**

`orb-dev-server` スキルの手順で PostgreSQL と Redis を用意し、`pnpm dev` の代わりに `pnpm build && pnpm migrate && pnpm start` で起動する（dev モードは Vite の dev サーバーを使うため、manifest の切り替えが効かない）。

- [ ] **Step 3: Playwright で確認する**

1. `/` を開く → バッジが出ず、本線の見た目である
2. `/__fe` を開く → `check` が一覧に出る
3. `check` をクリック → `/` に戻り、variant の見た目とバッジ「FE: check ✕」が出る。ネットワークで `/vite/` 配下のリクエストがすべて 200 である
4. 応答ヘッダーの `Cache-Control` が `private, no-store` である
5. バッジをクリック → 本線に戻り、バッジが消える
6. `/__fe/switch?v=../etc` → 404
7. Cookie を `mk_fe_variant=gone` に書き換えて再読み込み → 本線が表示され、バッジは出ない
8. `_skipped.json` に手で 1 件書いて再起動 → `/__fe` の「ビルドできなかった variant」に表示される
9. コンソールに CSP 違反などのエラーが出ていない

- [ ] **Step 4: 運用手順を書く**

`docs/frontend-variants.md` に次を書く。

- 仕組み: Cookie `mk_fe_variant` で、HTML に埋め込む manifest を切り替える
- variant の載せ方: Mac で機能ブランチを push し、mistems-main の `frontend-variants.yml` に追記して push する。`mode` を省略すると mistems-main に squash merge したものがビルドされる
- サーバーのデプロイ手順に足す 1 行: `pnpm build` の後、再起動の前に `node scripts/build-frontend-variants.mjs`
- 切り替え方: `/__fe` を開く。戻すときは左下のバッジをクリックする
- 取り込みでコンフリクトしたとき: `/__fe` にスキップ理由が出る。統合確認ブランチを作って `mode: as-is` で載せる
- 制約: backend の変更を含むブランチは確認できない。埋め込みは切り替わらない。localStorage と IndexedDB は本線と共有されるので、設定の移行を含むブランチを試すと本線に戻ったときに設定が壊れることがある。variant 1 つにつき、デプロイ時間が数分、ディスクが数十〜百数十 MB 増える（言語ごとのディレクトリを含むため）
- CDN を使う場合: `mk_fe_variant` Cookie があるリクエストは HTML のキャッシュを迂回する設定を入れる

- [ ] **Step 5: shipping-misskey-change スキルで最終確認して commit する**

```bash
git add docs/frontend-variants.md
git commit -m "docs: フロントエンド variant の運用手順を追加"
```

CHANGELOG は編集しない。引き継ぎでは候補として「フロントエンドの variant を Cookie で切り替えて確認できるように（MISTEMS 独自）」を 1 行示す。

---

## 追加設計（案A: 管理者向け UI と堅牢化）

6 体のマルチペルソナレビューの結果と、ユーザーとの合意（案A）を受けて、次のように変える。

- 切り替え UI は管理画面の 1 ページにし、`$i.isAdmin`（isAdministrator）のときだけ使えるようにする。Cookie は署名しない。手で Cookie を書けば管理者以外も切り替えられる点は受け入れる
- Cookie の設定は管理画面のページが `document.cookie` で行う。`/__fe/switch` は引数なしの「本線に戻す」専用にし、`v` を受け取らない（外部リンクからの強制切り替えを防ぐ）
- 公開の `/__fe` 一覧ページは削除する。代わりに `GET /__fe/variants.json` が、ビルドスクリプトの書き出した `frontend-variants/_variants.json` と、Cookie から決まる `current` を返す
- `_skipped.json` は `_variants.json` に統合する。形は `{ "variants": [{ name, branch, mode }], "skipped": [{ name, branch, reason }] }` とする
- スキップ理由は決まった文言だけにする。`e.message` などの詳細はデプロイのログにだけ出す

### Task 8: backend — 一覧 JSON・切り替えの縮小・起動直後の競合

**Files:**
- Modify: `packages/backend/src/server/web/frontend-variant.ts`、`packages/backend/test/unit/server/frontend-variant.ts`
- Modify: `packages/backend/src/server/web/HtmlTemplateService.ts`
- Modify: `packages/backend/src/server/web/ClientServerService.ts`

**Interfaces:**
- Produces（frontend-variant.ts）:
  - `export type VariantEntry = { name: string; branch: string; mode: 'merge' | 'as-is' }`
  - `export type VariantIndex = { variants: VariantEntry[]; skipped: SkippedVariant[] }`
  - `export function readVariantIndex(variantsRoot: string): VariantIndex` — `<variantsRoot>/_variants.json` を読む。ない・壊れている・形が違うときは `{ variants: [], skipped: [] }`。配列の要素は形の正しいものだけを残し、余分なフィールドは落とす。`mode` が `merge` / `as-is` 以外の要素は捨てる
  - `readSkippedVariants` は削除する（呼び出し元も置き換える）
- Produces（HTTP）: `GET /__fe/variants.json` → `{ current: string | null, variants: VariantEntry[], skipped: SkippedVariant[] }`。`variants` は `readVariantIndex` の `variants` のうち、HtmlTemplateService が実際に読み込めた（`getAvailableVariants()` に含まれる）ものだけにする。`_variants.json` に載っていないが読み込めたディレクトリは `{ name, branch: '', mode: 'as-is' }` として含める。応答ヘッダーは `Cache-Control: private, no-store`、`Content-Type: application/json; charset=utf-8`

**手順:**
- [ ] `readVariantIndex` のテストを先に書く（ファイルなし、壊れた JSON、トップレベルが配列、`variants` が配列でない、形の悪い要素と不正な mode の除去、余分なフィールドの除去、正常系）。RED を確認してから実装し、GREEN にする。`readSkippedVariants` のテストは削除する
- [ ] HtmlTemplateService: `frontendAssetsFetched` の真偽値をやめ、`private frontendAssetsPromise: Promise<void> | null = null` を持つ。`prepareFrontendAssets()` は Promise を一度だけ作り、以降の呼び出しは同じ Promise を await する。読み込み処理が throw したら Promise を null に戻し、次のリクエストで再試行できるようにする
- [ ] HtmlTemplateService: `listVariants(this.frontendVariantsRoot)` を try/catch で包み、例外時は `this.clientLoggerService.logger.warn` を出して variant なしで続ける
- [ ] HtmlTemplateService: `resolveVariant` は同期のままでよいが、`onSend` フックから呼ばれたときに未準備なら null になる点は変えない（HTML 応答は必ず `getCommonData` を経由するので準備済み）
- [ ] ClientServerService: `/__fe` の HTML ルートを削除し、`/__fe/variants.json` を追加する
- [ ] ClientServerService: `/__fe/switch` は `v` を見ずに常に Cookie を消して `/` にリダイレクトする（`Cache-Control: private, no-store`）。`isValidVariantName` の import が不要になれば消す
- [ ] `escapeHtml` の import が不要になれば消す
- [ ] 検証: `pnpm --filter backend test test/unit/server/frontend-variant.ts`、`pnpm --filter backend typecheck`、変更ファイルへの eslint --quiet
- [ ] commit: `feat(backend): variant 一覧を JSON で返し、切り替えは本線に戻す操作だけにする`

### Task 9: ビルドスクリプトの堅牢化と _variants.json

**Files:**
- Modify: `scripts/build-frontend-variants.mjs`

**手順:**
- [ ] 書き出すファイルを `_skipped.json` から `_variants.json`（`{ variants: [{ name, branch, mode }], skipped: [{ name, branch, reason }] }`、`variants` はビルドに成功したものだけ）に変える
- [ ] スキップ理由は決まった文言だけにする。予期しないエラーの reason は「予期しないエラー（デプロイのログを確認する）」とし、`e.message` とスタックは `console.warn` にだけ出す。`parseVariantList` 由来の errors（YAML の解析エラーの `e.message` を含む）も、reason を「frontend-variants.yml の書式が正しくない（デプロイのログを確認する）」系の定型文に置き換え、元の文言はログに出す
- [ ] fetch: 全体の `git fetch origin --prune` は残したうえで、variant ごとに `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>` を実行する（`GIT_TERMINAL_PROMPT=0`、timeout 120000ms、失敗は warn して手元の ref で続ける）。`FRONTEND_VARIANTS_NO_FETCH=1` のときはどちらも実行しない。fetch の stderr は warn に含める
- [ ] `pnpm install` と各ビルドに timeout を付ける（install 900000ms、build-pre 300000ms、frontend build 1800000ms）。タイムアウトはビルド失敗としてスキップする
- [ ] 終了コード 0 の保証: variant ループより後ろ（prune、`_variants.json` の書き出し、入れ替え、old の削除）と、ループより前の準備（`rmSync` / `mkdirSync`）を try/catch で包み、失敗は `console.error` を出して exit 0 で終わる
- [ ] 入れ替え: `renameSync(liveRoot, oldRoot)` の後に `renameSync(nextRoot, liveRoot)` が失敗したら、`renameSync(oldRoot, liveRoot)` で元に戻す（それも失敗したらログを出す）
- [ ] 検証: `node --check`、空の一覧で `FRONTEND_VARIANTS_NO_FETCH=1` 実行（exit 0、`_variants.json` が `{"variants":[],"skipped":[]}`）、存在しないブランチ 1 件で実行（skipped に定型文の reason）。後片付けをする
- [ ] commit: `fix: variant ビルドの結果を _variants.json に書き、失敗時もデプロイを止めないようにする`

### Task 10: frontend — 管理画面の variant ページ

**Files:**
- Create: `packages/frontend/src/pages/admin/frontend-variants.vue`
- Modify: `packages/frontend/src/router.definition.ts`（admin の子ルートに `path: '/frontend-variants'`、`name: 'frontend-variants'`）
- Modify: `packages/frontend/src/pages/admin/index.vue`（`/admin/external-services` の項目の近くに `icon: 'ti ti-git-branch'`、`to: '/admin/frontend-variants'` の項目を追加）。この項目は `iAmAdmin` のときだけ出す
- Modify: `locales/ja-JP.yml`（ja-JP 以外は編集しない）

**仕様:**
- ページは `iAmAdmin`（`@/i.js`）が false なら、権限がない旨だけを表示する
- `/__fe/variants.json` を `window.fetch` で取得する（Misskey の API ではないので `misskeyApi` は使わない）。取得失敗時はエラー表示
- 「本線」と各 variant を一覧で出し、`current` に印を付ける。各 variant には `branch` と `mode` を小さく添える
- 切り替え: variant を選んだら `document.cookie = 'mk_fe_variant=<name>; Path=/; Max-Age=604800; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '')` を設定して `location.reload()`。本線を選んだら `location.href = '/__fe/switch'`
- `skipped` があれば、名前・ブランチ・理由を一覧で出す
- 文言は `locales/ja-JP.yml` に `_frontendVariants:` のまとまりで追加する（タイトル、説明、本線、表示中、ビルドできなかった variant、権限なし、読み込み失敗）
- `working-on-frontend` スキルの規約（`<script setup lang="ts">`、`Mk*` コンポーネント、`i18n.ts`、SCSS Modules）に従う。既存の `pages/admin/external-services.vue` などの作りに合わせる

**手順:**
- [ ] 実装し、`pnpm --filter frontend exec vue-tsc --noEmit`（または frontend の typecheck スクリプト）と変更ファイルへの eslint --quiet を通す
- [ ] locale を変えたので、frontend の型生成が必要なら実行する（`pnpm --filter i18n build` など、working-on-frontend スキルの指示に従う）
- [ ] commit: `feat(frontend): 管理画面にフロントエンド variant の切り替えページを追加`

### Task 11: 運用手順の更新と通し確認

- [ ] `docs/frontend-variants.md` を更新する: 切り替えは管理画面から行う、`/__fe` 一覧ページは廃止、`/__fe/variants.json` の存在、`_variants.json`、信頼境界（yml に載せたブランチの install script とビルドが本番 VPS のデプロイ権限で実行される。リリース候補だけを載せる）、ビルド負荷（本番と同じ VPS で variant ごとにビルドするので、メモリに余裕がないときは variant を減らす）、スクリプトの直後にプロセスを再起動する、切り替え直後に最大 30 秒は古い HTML が返りうる
- [ ] commit: `docs: フロントエンド variant の運用手順を管理画面での切り替えに合わせる`
- [ ] 通し確認（コントローラー）: 本番ビルドで起動し、管理者でログイン → 管理画面の variant ページで `check` に切り替え → 見た目とバッジ → バッジで本線に戻る。非管理者ではページの中身が出ない。`/__fe/switch?v=check` で Cookie が付かない。`/__fe/variants.json` の内容と Cache-Control
