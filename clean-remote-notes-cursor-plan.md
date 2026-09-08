# cleanRemoteNotes のカーソル永続化 実装計画

作成: 2026-07-28。ブランチ `perf/clean-remote-notes-cursor`（origin/develop 直系, f6979333d4 起点）。

> **For agentic workers:** 実装時は superpowers:subagent-driven-development または
> superpowers:executing-plans でタスク単位に実行すること。チェックボックスで進捗管理する。
> backend のコードを触る前に `working-on-backend` スキル、commit 前に
> `shipping-misskey-change` スキルの参照が必須（AGENTS.md 13/15）。

**Goal:** リモートノート掃除ジョブ (`CleanRemoteNotesProcessorService`) の走査カーソルを Redis に永続化し、毎晩最古ノートから再走査するシーシュポス構造を解消する。

**Architecture:** ジョブ開始時に Redis からカーソルを読んで再開し、バッチごとに保存、全域走査を完走したらキーを削除して次回はフル再走査（ピン留め解除等で削除可能になったノートを拾い直すため）。migration 不要・設定追加不要の最小変更。

**Tech Stack:** NestJS DI (`DI.redis` / ioredis), vitest (既存の統合型ユニットテスト), TypeORM (変更なし)

## 背景（調査済み・2026-07-28 未明の3台観察より）

- `WITH RECURSIVE candidate_notes` クエリ（本ジョブの心臓部）が pg_stat_statements の
  実行時間合計で3台とも1位: **systems 80.0% (平均10.4s/バッチ)、gamelore 37.7%、favskey 85.0%**
- 3台とも設定は 毎日04:00起動・最長360分・expiry 90日 (`meta` テーブルで確認済み)
- **決定的な実測**: 90日境界のすぐ内側（95〜100日前の窓）の削除候補ルートノート1,000件を
  サンプリングしたところ、削除可能割合は **systems 99.8% / gamelore 100% / favskey 99.8%**。
  つまり境界付近は一度も掃除されていない。一方、最古側1,000件は 4.1〜23.6% しか
  削除可能でない（＝ほぼ掃除済み。残りはツリー内に消せない子を持つもの）
- 原因はコードで特定済み: `process()` 内で `let cursorLeft = '0';` と**毎ラン初期化**され、
  ラン間で保存されない
  ([CleanRemoteNotesProcessorService.ts:123](packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts#L123) 付近)。
  毎晩最古から歩き直し、「消せないノート密集地帯」の NOT EXISTS 再検証 (×3 サブクエリ) に
  6時間の予算を食われ、前線（2019年ごろ）に到達した時点でタイムアウトする
- systems の削除ペースは日数百〜千件オーダーに対し、リモートノート流入は日数万件。
  **境界を越えて対象入りする量 > 日次削除量** で、差は開き続けている
- 上流 issue: コード内コメントに #17057 への言及あり（statement timeout フォールバック）。
  カーソル永続化自体は上流にも入っていない (develop f6979333d4 時点)

## 対象と方針

- 対象ファイル: `packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts` のみ
  （+ 既存テスト `packages/backend/test/unit/queue/processors/CleanRemoteNotesProcessorService.ts`）
- カーソルの保存先は **Redis**（キー: `cleanRemoteNotes:cursor`）
  - meta テーブル案は却下: migration が必要になり、meta はコンフィグの置き場で
    ジョブの実行時状態を持たせる場所ではない。metaUpdated のブロードキャストも無駄
  - Redis 消失時はカーソルが '0' に戻るだけ（現状と同じ挙動に退行）で安全
  - キー命名は素の `cleanRemoteNotes:cursor`。prefix は ioredis のグローバル設定が付与する
    （前例: `FetchInstanceMetadataService` の `fetchInstanceMetadata:mutex:v2:${host}`）
- 再開セマンティクス:
  - ジョブ開始時: `GET cleanRemoteNotes:cursor` → あれば再開、なければ '0'
  - 各バッチでカーソルが進むたび `SET`（ジョブがクラッシュしても直近位置から再開できる）
  - タイムアウト打ち切り時: 最終カーソルを `SET`（バッチごと保存があるので実質冪等だが明示）
  - **完走時（"No more notes to clean."）: `DEL`** → 次ランは '0' からフル再走査。
    ピン留め解除・お気に入り解除・ローカルユーザー削除などで後から削除可能になった
    ノートを拾い直すために必要。定常状態は「数晩かけて全域を一周するローリングスキャン」になる
  - 不正値ガード: 取得値が `/^[0-9a-z]+$/` にマッチしなければ '0' 扱い
- 観測性: 再開時に `this.logger.info` でカーソル位置を出す（papertrail に乗る。
  現状 `job.log()` は Bull/Redis にしか残らず papertrail から進捗が見えない問題への手当て）
- ジョブ戻り値に `resumedFromCursor: string | null` を追加（Bull ダッシュボードでの確認用。
  API スキーマ変更ではないので misskey-js 再生成は不要）

## コンフリクト分析

- `git log --oneline --all --not develop -- .../CleanRemoteNotesProcessorService.ts` →
  実質的な変更はマージコミットのみで、対象ファイルを触る作業ブランチは無い
- 対象1ファイル + テスト1ファイルのみ。コンフリクトの懸念は無い
- entity / migration / API スキーマ変更なし → `check-migrations` / `build-misskey-js-with-types` 不要

## 実装方針（詳細）

### Task 1: カーソルの読み出しと再開

**Files:**
- Modify: `packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts`
- Test: `packages/backend/test/unit/queue/processors/CleanRemoteNotesProcessorService.ts`

**Interfaces:**
- Produces: Redis キー `cleanRemoteNotes:cursor`（値は note id 文字列）、
  定数 `CLEAN_REMOTE_NOTES_CURSOR_KEY = 'cleanRemoteNotes:cursor'`（テストから参照するため export）

- [ ] **Step 1: 失敗するテストを書く**

既存テストファイルの describe 内に追加（`createNote` / `meta` / `createMockJob` は既存ヘルパーを流用。
GlobalModule 経由で実 Redis が使えるので `app.get<Redis.Redis>(DI.redis)` を取得しておく）:

```ts
test('resumes from persisted cursor: notes below cursor are skipped', async () => {
	// 91日前の削除可能なリモートノートを2つ、時刻をずらして作成
	const oldTime = Date.now() - ms('91 days');
	const noteA = await createNote({}, bob, oldTime);            // カーソルより下
	const noteB = await createNote({}, bob, oldTime + 1000);     // カーソルより上

	// noteA と noteB の間にカーソルを置いて「noteA は処理済み」を偽装
	await redisClient.set(CLEAN_REMOTE_NOTES_CURSOR_KEY, noteA.id);

	const result = await service.process(createMockJob() as any);

	// noteA はカーソルより下なのでスキップされ生存、noteB は削除される
	await expect(notesRepository.findOneBy({ id: noteA.id })).resolves.not.toBeNull();
	await expect(notesRepository.findOneBy({ id: noteB.id })).resolves.toBeNull();
	expect(result.resumedFromCursor).toBe(noteA.id);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter backend test -- CleanRemoteNotesProcessorService`
Expected: FAIL（`CLEAN_REMOTE_NOTES_CURSOR_KEY` が未定義 / `resumedFromCursor` が undefined）
※ 事前に `.config/test.yml` が必要（`cp .github/misskey/test.yml .config/test.yml`）

- [ ] **Step 3: 最小実装**

```ts
// import に追加
import * as Redis from 'ioredis';

// クラス外（export して テストから参照）
export const CLEAN_REMOTE_NOTES_CURSOR_KEY = 'cleanRemoteNotes:cursor';

// constructor に注入を追加
@Inject(DI.redis)
private redisClient: Redis.Redis,
```

`process()` 内の `let cursorLeft = '0';` を置き換え:

```ts
const storedCursor = await this.redisClient.get(CLEAN_REMOTE_NOTES_CURSOR_KEY);
const resumedFromCursor = (storedCursor != null && /^[0-9a-z]+$/.test(storedCursor)) ? storedCursor : null;
let cursorLeft = resumedFromCursor ?? '0';
if (resumedFromCursor) {
	this.logger.info(`resuming from cursor ${resumedFromCursor}`);
}
```

戻り値の型と全 return 箇所に `resumedFromCursor` を追加
（early return 3箇所は `resumedFromCursor: null`、通常完了は `resumedFromCursor`）。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter backend test -- CleanRemoteNotesProcessorService`
Expected: 新規テスト PASS、既存テストも全て PASS（cursor キー未設定なら従来挙動）

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts \
        packages/backend/test/unit/queue/processors/CleanRemoteNotesProcessorService.ts
git commit -m "enhance(backend): cleanRemoteNotesのカーソルをRedisから再開できるように"
```

### Task 2: カーソルの保存と完走時のリセット

**Files:**
- Modify: `packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts`
- Test: `packages/backend/test/unit/queue/processors/CleanRemoteNotesProcessorService.ts`

**Interfaces:**
- Consumes: Task 1 の `CLEAN_REMOTE_NOTES_CURSOR_KEY` / `redisClient`

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('persists cursor per batch and clears it on completion', async () => {
	const oldTime = Date.now() - ms('91 days');
	await createNote({}, bob, oldTime);

	const setSpy = vi.spyOn(redisClient, 'set');

	const result = await service.process(createMockJob() as any);

	// バッチ処理でカーソルが SET され、完走時に DEL されている
	expect(setSpy.mock.calls.some(([key]) => key === CLEAN_REMOTE_NOTES_CURSOR_KEY)).toBe(true);
	await expect(redisClient.get(CLEAN_REMOTE_NOTES_CURSOR_KEY)).resolves.toBeNull();
	expect(result.skipped).toBe(false);
	setSpy.mockRestore();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter backend test -- CleanRemoteNotesProcessorService`
Expected: FAIL（SET が呼ばれていない）

- [ ] **Step 3: 最小実装**

ループ末尾、`cursorLeft` を進めた直後（`job.log(\`Deleted ...\`)` の手前）に追加:

```ts
await this.redisClient.set(CLEAN_REMOTE_NOTES_CURSOR_KEY, cursorLeft);
```

タイムアウト分岐（`Reached maximum duration` の `break` 直前）にも同じ1行を追加。

完走系の break（`'No more notes to clean.'` の2箇所）と、minId が無い early return の直前に:

```ts
await this.redisClient.del(CLEAN_REMOTE_NOTES_CURSOR_KEY);
```

※ statement timeout フォールバックの `cursorLeft = lastId; continue;` 経路は
次周回のループ末尾 SET で保存されるので追加不要。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter backend test -- CleanRemoteNotesProcessorService`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts \
        packages/backend/test/unit/queue/processors/CleanRemoteNotesProcessorService.ts
git commit -m "enhance(backend): cleanRemoteNotesのカーソルをバッチごとに保存し完走時にリセット"
```

### Task 3: 仕上げ（CHANGELOG / lint / 出荷前チェック)

- [ ] **Step 1: CHANGELOG.md の `## Unreleased` → `### Server` に追記**

```
- Enhance: リモートノートのクリーンアップが前回の続きから再開されるように
```

- [ ] **Step 2: lint**

Run: `pnpm lint`
Expected: エラー 0

- [ ] **Step 3: `shipping-misskey-change` スキルのチェックリストを完走して commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG に cleanRemoteNotes カーソル再開を追記"
```

## デプロイ後の運用（追いつき運転）

1. デプロイ後、数晩は前線が境界へ向けて前進する（カーソルが持ち越されるため）。
   進捗は papertrail の `resuming from cursor` 行で追える（aid の先頭8桁を base36
   デコードすると時刻になる）
2. 早く追いつかせたい場合はコントロールパネルから
   `remoteNotesCleaningMaxProcessingDurationInMinutes` を一時的に増やす（例: 360→720）。
   追いついたら戻す
3. **受け入れ確認**: 観察時に使った 95〜100日前窓のサンプリング SQL（下記）で
   removable 割合が 99.8〜100% → 数%台に落ちれば成功

```sql
SET statement_timeout='180s';
WITH cand AS (
  SELECT id FROM note
  WHERE id > :d100 AND id < :d95  -- 100日前/95日前の aid 境界（node で生成）
    AND "userHost" IS NOT NULL AND "replyId" IS NULL AND "renoteId" IS NULL
    AND "clippedCount" = 0 AND "pageCount" = 0
  ORDER BY id ASC LIMIT 1000
)
SELECT count(*) AS sampled,
  count(*) FILTER (WHERE
    NOT EXISTS (SELECT 1 FROM user_note_pining p WHERE p."noteId" = cand.id)
    AND NOT EXISTS (SELECT 1 FROM note_favorite f WHERE f."noteId" = cand.id)
    AND NOT EXISTS (SELECT 1 FROM note_reaction r JOIN "user" u ON r."userId" = u.id
                    WHERE r."noteId" = cand.id AND u."host" IS NULL)
  ) AS removable
FROM cand;
```

## 上流 PR の可能性

- 機能自体が上流 (misskey-dev) 由来で、カーソルリセットは上流にもそのまま存在する。
  migration 不要・Redis のみの最小変更なので upstream PR の題材として筋が良い
- 出す場合は `creating-issues-and-prs` スキルを参照のこと
