# ユーザー検索 (メンション補完) の前方一致インデックス計画

作成: 2026-07-23。ブランチ `index-optimize` に追加。

## 問題（調査済み・確定）

- **現象**: メンション補完 UI で1文字打つたびに `UserSearchService`
  （`users/search-by-username-and-host`）が
  `usernameLower LIKE 'prefix%' AND isSuspended = FALSE AND id NOT IN
  (フォロー済み) AND updatedAt > (30日前)` を発行し、
  **1クエリ 6.5秒（コールド）/ 320ms（ウォーム）**かかっていた
  （MisskeySystems 実測、2026-07-23 00:58 JST のログ）
- **原因**: `usernameLower` の既存インデックスは UNIQUE btree
  `("usernameLower", host)` だが、DB の照合順序が `en_US.UTF-8` のため
  **`LIKE 'prefix%'` の範囲条件として使えない**。プランナーは代替として
  updatedAt 系インデックスを歩き、**38,127 行をフィルタで捨てていた**
  （EXPLAIN ANALYZE で確認、user テーブルは 343,692 行）

## 修正

`text_pattern_ops` オペレータクラス付きインデックスを 1 本追加:

```sql
CREATE INDEX "IDX_user_usernameLower_pattern"
    ON "user" ("usernameLower" text_pattern_ops);
```

- 前方一致 LIKE が `>= 'prefix' AND < 'prefiy'` 相当の範囲シークになり、
  ミリ秒に落ちる
- オペレータクラスは TypeORM のエンティティデコレータで表現できないため、
  **migration のみで管理**する（前例: `1767169026317-birthday-index.js` の
  関数インデックス。check-migrations はエンティティ外インデックスを許容する）
- migration はブランチ既存の冪等ヘルパー流儀
  （CONCURRENTLY は `MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY=1`、
  INVALID 残骸の自動除去、hotfix 済み環境では自動スキップ）

## 本番 hotfix

migration 到着前の応急として、同名インデックスを手動作成可能（無停止）:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_user_usernameLower_pattern"
    ON "user" ("usernameLower" text_pattern_ops);
```

migration 側は同名の有効インデックスがあればスキップするため二重作成にならない。

## 検証

- `pnpm --filter backend check-migrations` が 0 件で通る（エンティティ外
  インデックスとして扱われること）
- `pnpm migrate` → `pnpm revert` → `pnpm migrate` が通る
- デプロイ後、実クエリの EXPLAIN で
  `Index Scan using IDX_user_usernameLower_pattern` + `Index Cond` に
  変わること（Filter での大量 Rows Removed が消えること）
- 体感: メンション補完のもたつき解消

## 備考

- 中間一致 (`%query%`) の経路（UserSearchService の別分岐）はこの
  インデックスでは救えない。必要なら pg_trgm / PGroonga の領分
  （PGroonga検索Indexブラッシュアップ計画.md と関連）
- upstream 候補: 照合順序が C 以外の全インスタンスで同じ問題が起きるはず
