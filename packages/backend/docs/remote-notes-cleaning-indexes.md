# リモートノートクリーナー パフォーマンス改善メモ

このドキュメントは、Issue [misskey-dev/misskey#17057](https://github.com/misskey-dev/misskey/issues/17057)
（リモートノートクリーナーのタイムアウト）への対応として行った修正と、
それに伴って必要となるインデックスのメンテナンス手順をまとめたものです。

## 背景

`CleanRemoteNotesProcessorService` は再帰CTEで `note` ツリーを掘りながら
削除可能なリモートノートを特定し、`notesRepository.delete(...)` で削除します。
`note` テーブルの行数が数百万〜数千万に達した環境では、

- `MIN(note.id)` を取る `minId` クエリ
- `idWindow`（次のルートノート探索）クエリ
- `DELETE FROM note WHERE id = ANY(...)` の DELETE 本体

がいずれもグローバルな `statement_timeout`（API 保護のため数秒〜10秒程度に
設定されることが多い）に引っかかり、ジョブが crash → 進捗ゼロで再実行を繰り返す
状態に陥っていました。

## コード側の修正

`packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts`

1. `minId` クエリを `try/catch` で包み、PostgreSQL のステートメントタイムアウト
   （SQLSTATE `57014`）を捕捉。捕捉時はジョブを skip し次回実行に委ねる。
2. `idWindow` クエリ（最小バッチでも CTE がタイムアウトした際の救済クエリ）
   にも同じタイムアウトハンドリングを追加。
3. DELETE をトランザクションでラップし、トランザクション内で
   `SET LOCAL statement_timeout = '300s'` を発行。
   `SET LOCAL` はトランザクション終了時に自動で元に戻るため、
   API 用パスのグローバル設定には影響しません。
4. それでも DELETE がタイムアウトした場合は、CTE 側と同じパターンで
   `currentLimit` を 1/4 に縮小しカーソルを進めずリトライ。
   既に最小バッチに達していれば `break` で安全終了。

## インデックスの再作成手順

`note` テーブルが大きい環境では、上記コード修正だけでは不十分なことがあります。
以下のインデックスがクリーナーの SELECT/DELETE のホットパスに直接効いてくるので、
**膨張していたり統計情報が古い場合は再作成・再収集を実施してください。**

対象は最低限以下の 3 つです（既に DDL は存在するので、ここで作るのは
壊れた／肥大化したインデックスの差し替えのみ）。

| 列 | 用途 | TypeORM の宣言 |
|---|---|---|
| `note(replyId)` | 再帰 CTE で親ノートに JOIN | `MiNote.replyId` の `@Index()` |
| `note(renoteId)` | 同上（Renote 側） | `MiNote.renoteId` の `@Index()` |
| `note(userHost)` | リモートノート絞り込み | `MiNote.userHost` の `@Index()` |
| `note(userId, id DESC)` | カーソル走査 | `IDX_724b311e6f883751f261ebe378` |

### 0. 事前確認

サーバーから一時的にクリーナージョブを止めておきます（`enableRemoteNotesCleaning`
を OFF）。

```sql
-- 現在のインデックス名と健全性を確認
SELECT
    c.relname        AS index_name,
    pg_size_pretty(pg_relation_size(c.oid)) AS size,
    i.indisvalid     AS is_valid,
    i.indisready     AS is_ready
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_class t ON t.oid = i.indrelid
WHERE t.relname = 'note'
ORDER BY pg_relation_size(c.oid) DESC;
```

`is_valid` が `false` のインデックス、もしくは膨張が酷いインデックスを再作成対象とします。

### 1. CONCURRENTLY で新インデックスを作る

`note` は超巨大テーブルなので、**必ず `CREATE INDEX CONCURRENTLY` を使う**こと。
書き込みを止めずに作成できますが、トランザクション内では実行できません。

```sql
-- replyId
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_note_replyId_new"
    ON "note" ("replyId")
    WHERE "replyId" IS NOT NULL;

-- renoteId
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_note_renoteId_new"
    ON "note" ("renoteId")
    WHERE "renoteId" IS NOT NULL;

-- userHost（リモートのみで十分なので部分インデックス推奨）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_note_userHost_new"
    ON "note" ("userHost")
    WHERE "userHost" IS NOT NULL;

-- userId, id DESC（既存と同じ定義で再作成する場合）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_724b311e6f883751f261ebe378_new"
    ON "note" ("userId", "id" DESC);
```

`CONCURRENTLY` は失敗すると `INVALID` 状態のインデックスが残ります。
途中で失敗した場合は `DROP INDEX CONCURRENTLY` でそれを掃除してから
やり直してください。

### 2. 旧インデックスを差し替える

新しいインデックスが `indisvalid = true` になっているのを確認したうえで、
**TypeORM の同期で消されないよう、最終的な名前は元と同じにしておく**のが安全です。
もし元のインデックス名が typeorm 自動生成（例: `IDX_xxxxxxxx`）の場合、
リネームで揃えます。

```sql
BEGIN;
-- 既存の壊れた／肥大化したインデックスを削除
DROP INDEX CONCURRENTLY IF EXISTS "IDX_<旧>";
-- 新規作成したインデックスを元の名前にリネーム
ALTER INDEX "IDX_note_replyId_new" RENAME TO "IDX_<旧>";
COMMIT;
```

`DROP INDEX CONCURRENTLY` はトランザクションの外で実行する必要があります。
リネームのみトランザクションに入れてください。

### 3. 統計情報の更新

`composite-note-index` マイグレーション (`1745378064470-composite-note-index.js`)
でも `ANALYZE` を呼んでいる通り、`note` の統計が古いと
プランナが seq scan を選びがちです。**必ず再 ANALYZE する**こと。

```sql
ANALYZE VERBOSE "note";
ANALYZE VERBOSE "note_reaction";
ANALYZE VERBOSE "note_favorite";
ANALYZE VERBOSE "user_note_pining";
ANALYZE VERBOSE "user";
```

### 4. 確認

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT MIN(note.id)
FROM note
WHERE note."id" < '<newestLimit>'
  AND note."userHost" IS NOT NULL
  AND note."replyId" IS NULL
  AND note."renoteId" IS NULL;
```

`Index Scan` または `Index Only Scan` が選ばれていれば OK。
`Seq Scan on note` が出る場合は手順 3 の ANALYZE が効いていないか、
部分インデックスの条件が `WHERE` と整合していない可能性があります。

### 5. クリーナーを再開

`enableRemoteNotesCleaning` を ON に戻し、ログで

- `Deleted N notes; Xms` の X が安定して数百ms〜数秒に収まること
- `Local note tree complexity is too high...` が頻発しないこと
- `DELETE query timed out ...` が出ないこと

を確認します。

## 参考

- 上流 PR [misskey-dev/misskey#17306](https://github.com/misskey-dev/misskey/pull/17306)
  （wrong fork 起因で close。本リポジトリには独自実装で取り込み済み）
- 元の改善 PR [misskey-dev/misskey#16752](https://github.com/misskey-dev/misskey/pull/16752)
  （タイムアウト時の bailout を skip に変えた既存改善）
