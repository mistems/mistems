# ホームタイムライン DB フォールバックの高速化計画（LATERAL JOIN 方式）

作成: 2026-07-24。favskey で report された「タイムマシン（過去に遡る）が遅い／
使い物にならない」の根本原因調査から着手する修正。

## 背景・実測データ（調査済み）

- favskey の pg_stat_statements で総実行時間1位（クリーナー除く）だった
  ホームタイムラインの DB フォールバッククエリを auto_explain の実ログ
  （5日分、`log_min_duration=1s` のため1秒未満は捕捉外）で分析
- 5日間で13回発生（p50=4.7秒 / p90=8.4秒 / max=8.5秒）。**うち7回（54%）が
  単一ユーザー `9vt5cndgmexj17w4`（658人フォロー）に集中**、しかも
  2026-07-22 08:31〜08:36 の5分間に5連続（毎回8秒前後）
- 残り6回は5〜6名の別ユーザーに散発 → フォロー数が多いユーザー全般に
  起こりうる問題で、レアケースではない
- EXPLAIN ANALYZE で機構を特定: `note.userId IN (658人)` を含む
  `ORDER BY note.id DESC LIMIT n` クエリで、PostgreSQL は
  `(userId, id DESC)` 複合インデックス（`IDX_a6f649630f55af3888e5a42919`）
  を使わず、**主キー `id` を新しい順に全走査しながらフィルタ**する計画を選ぶ
  （実測: 47,143 buffers 読取、うち大半がフィルタで破棄）
- `enable_indexscan=off` で強制実験した結果、複合インデックス版
  （Bitmap Index Scan）は **むしろ大幅に遅い**（15秒、123,000+ buffers）と
  判明。理由: `userId IN` だけで絞ると 108,405 行ヒットし、id で再ソートが
  必要になるため。つまり**現状のプランはこのクエリ形のままでは正しい選択**
- LATERAL JOIN 方式（followee ごとに `id DESC LIMIT K` を取得してマージ）を
  同条件で試験したところ、コールド時の読み込みブロック数が
  **7,253（現状の約1/6.5）**。ウォーム時は逆に現状より遅い（657回の
  インデックスシークのオーバーヘッドのため）が、favskey は RAM 3.8GB /
  DB 65GB でキャッシュに乗り切らない環境（既知）なので、**コールドが典型的
  な発生パターン**と判断
- Redis 側の fanout timeline（`list:homeTimeline:<userId>`）は正常に機能
  しており（`perUserHomeTimelineCacheMax=300` 相当の件数を保持）、
  このフォールバックは「300件より深くスクロール／過去に遡った」ときの
  **設計どおりの経路**。B案（キャッシュ件数を増やすだけ）は対症療法で、
  タイムマシン機能がある以上いずれ同じ壁に当たるため不採用

## スコープ

- **対象**: `packages/backend/src/server/api/endpoints/notes/timeline.ts` の
  `getFromDb` メソッドのみ
- **対象外（将来検討）**: `hybrid-timeline.ts` / `user-list-timeline.ts` /
  `channels/timeline.ts` / `users/notes.ts` にも同型の
  `userId IN (大量) ORDER BY id DESC LIMIT n` パターンが存在する
  （`getFromDb` を持つことを grep で確認済み）が、今回は実測で問題が
  確認できた home timeline に絞る。横展開は効果測定後に別タスクとする

## コンフリクト分析（今回の要求の核心）

### 調査方法

`packages/backend/src/server/api/endpoints/notes/timeline.ts` /
`packages/backend/src/core/QueryService.ts` /
`packages/backend/src/core/FanoutTimelineEndpointService.ts` を対象に、
関連する3つの fanout-timeline 系ブランチとの `git diff --stat` を
それぞれ確認した。

| ブランチ | main-統合.sh 登録 | notes/timeline.ts | QueryService.ts | FanoutTimelineEndpointService.ts |
|---|---|---|---|---|
| `riin/fix/fanout-timeline` | **済**（統合済み） | 77行目1行のみ | 変更なし | **116行変更**（大規模） |
| `riin/fix/fanout-timeline-redis-gap` | 未登録 | 変更なし | 変更なし | **35行変更** |
| `riin/fix/fanout-timeline-toggle-purge` | 未登録 | 77行目1行のみ（内容同一） | 変更なし | 変更なし |

`notes/timeline.ts` への変更は3ブランチとも下記の**1箇所だけ**（77行目、
`fix/fanout-timeline` 経由で mistems-main に統合済み、develop 側は未反映）:

```diff
- if (!this.serverSettings.enableFanoutTimeline) {
+ if (!this.serverSettings.enableFanoutTimeline || !this.serverSettings.fanoutTimelineActive) {
```

今回変更する `getFromDb` メソッド本体（142〜267行目、クエリ構築ロジック）は
**3ブランチのいずれからも一切変更されていない**ことを確認済み。

### 結論と対応方針

1. **`QueryService.ts` は無傷**なので触っても他ブランチと衝突しない。
   ただし本計画では変更しない設計にする（後述）
2. **`FanoutTimelineEndpointService.ts` は統合済み・未統合の両方から
   激しく変更されている**ため、**今回は一切触らない**。
   `dbFallback` コールバックの契約（`(untilId, sinceId, limit) => Promise<MiNote[]>`
   を満たせば、呼び出し側の再フェッチ・段階読みロジック
   （`getMiNotes` 内の bounded query → gap-fill safety net の2段構え、
   190〜255行目）には一切関与不要。これにより将来 `redis-gap` ブランチが
   統合されてもコンフリクトしない
3. **77行目には触れない**（`getFromDb` 呼び出し条件の分岐はそのまま）
4. **ベースブランチは `origin/develop` とする**（MISTEMS の標準フロー。
   resync-charts-timeout / http-abort-timer / index-optimize と同じ流儀）。
   77行目の差分は自分のブランチに含まれないため、squash merge 時に
   `fix/fanout-timeline` 系との重複・競合は発生しない

**結論: 対象コードは develop 起点でよく、FTTL 系ブランチの統合順序を
気にする必要はない。** 唯一の注意点は「`getFromDb` 本体（142行目以降）に
だけ変更を閉じ、77行目・`QueryService.ts`・`FanoutTimelineEndpointService.ts`
には触れない」という制約を実装時に守ること。

## 設計方針: 2段階アプローチ

### なぜ2段階か

`getFromDb` は現在、`user` / `reply` / `renote` / `replyUser` / `renoteUser`
を JOIN した上で block・mute・visibility 等のフィルタを一発の
`ORDER BY id DESC LIMIT n` クエリで完結させている。フィルタ関数を
精読した結果、以下のように分類できる（`QueryService.ts` の実装確認済み）:

| フィルタ関数 | 依存 | LATERAL 内で複製可能か |
|---|---|---|
| `generateVisibilityQuery` | `note.*` カラムのみ（+ following サブクエリ） | ✅ 可能 |
| `generateMutedUserQueryForNotes` | `note.*` カラムのみ（+ muting サブクエリ） | ✅ 可能 |
| `generateMutedUserRenotesQueryForNotes` | `note.*` カラムのみ | ✅ 可能 |
| `generateBlockedUserQueryForNotes` | `note.*` カラムのみ（+ blocking サブクエリ） | ✅ 可能 |
| `generateBlockedHostQueryForNote` | `note.*` カラムのみ（userHost 等は非正規化済み） | ✅ 可能 |
| `generateSuspendedUserQueryForNote` | **`user.isSuspended` / `replyUser.isSuspended` / `renoteUser.isSuspended`**（JOIN 必須、コメントに `Requirements: user replyUser renoteUser must be joined` と明記） | ❌ 不可（JOIN が要る） |

6つ中5つは `note` テーブル単体のカラムとサブクエリだけで完結し、
JOIN が要るのは `isSuspended` チェック（凍結ユーザー除外）だけ。
これを踏まえ、正確性を犠牲にしないハイブリッド設計にする:

```
Phase 1 (LATERAL, 新規):
  followee ごとに (userId, id DESC) を使って浅くシークし、
  candidateIds を limit の安全マージン倍（初期値: limit * 3）だけ集める。
  visibility / mute / renoteMute / block-host / block-user は
  Phase 1 の LATERAL 内で複製して弾く（isSuspended だけは弾かない）。

Phase 2 (既存ロジックの再利用):
  Phase 1 で得た candidateIds に対して、既存の JOIN ＋
  generateSuspendedUserQueryForNote を含む「今の getFromDb と全く同じ
  フィルタ一式」を note.id IN (candidateIds) で絞って適用し、
  limit 件に確定させる。

Safety net:
  Phase 2 の結果が limit 未満だった場合（isSuspended 除外や
  マージン不足で取りこぼした場合）、現行の実装（PKスキャン＋
  userId IN 版）にそのままフォールバックする。
  → 正確性は現行実装と完全に同一であることが保証される。
  → FanoutTimelineEndpointService 側の「1段目 bounded → 2段目
    gap-fill」と同じ思想（既存コードベースの慣習に合わせる）。
```

これにより「本来 limit 件あるはずなのに LATERAL の LIMIT で
取りこぼす」心配を、Phase 2 の再フィルタ＋ safety net で完全に消せる。
Phase 1 の役割は「候補を絞り込んで読み込みブロック数を減らすこと」に
徹し、正確性の責務は一切負わない。

### Phase 1 の SQL 形（4パターン、既存の if/else if/else 分岐に対応）

現在の `getFromDb` は followees / followingChannelIds の有無で4パターンに
分岐している（155〜201行目）。Phase 1 の LATERAL もこれに対応する
4パターンを用意する。代表例（ユーザー・チャンネル両方フォローあり、
最も複雑なケース）:

```sql
WITH user_candidates AS (
  SELECT n.id FROM unnest($1::varchar[]) AS f(uid)
  CROSS JOIN LATERAL (
    SELECT note.id FROM note
    WHERE note."userId" = f.uid
      AND note."channelId" IS NULL
      AND note.id < $2  -- untilId（sinceId 指定時は向きを反転）
      -- ここに generateVisibilityQuery 等 5関数相当の条件を複製
    ORDER BY note.id DESC
    LIMIT $3  -- 安全マージン込みの K
  ) n
), channel_candidates AS (
  SELECT n.id FROM unnest($4::varchar[]) AS f(cid)
  CROSS JOIN LATERAL (
    SELECT note.id FROM note
    WHERE note."channelId" = f.cid
      AND note.id < $2
    ORDER BY note.id DESC
    LIMIT $3
  ) n
)
SELECT id FROM user_candidates
UNION
SELECT id FROM channel_candidates
ORDER BY id DESC
LIMIT $5  -- limit * マージン倍率
```

「ユーザーフォローのみ」「チャンネルフォローのみ」「フォローなし」の
3パターンは `user_candidates` / `channel_candidates` のどちらか一方だけ、
または LATERAL 自体を使わない単純な `WHERE userId = :meId` に簡略化する
（フォロー数が少ない＝もともと現行実装でも速いケースなので、無理に
LATERAL 化しなくてよい。**フォロー数が閾値未満なら Phase 1 を丸ごとスキップ
して現行実装を直接使う**、という早期リターンも検討する）。

## 変更対象ファイルと変更内容（詳細）

### `packages/backend/src/server/api/endpoints/notes/timeline.ts`

- **触るのは `getFromDb` メソッド（142〜267行目）のみ**
- 冒頭（1〜141行目: import, meta, paramDef, constructor, 77行目の分岐）は
  一切変更しない
- 変更方針:
  1. `getFromDb` の先頭で `followees.length` が閾値
     （要決定、初期値案: 50）未満なら、既存の実装（現状のコードそのまま）
     を実行して early return
  2. 閾値以上の場合のみ Phase 1（LATERAL, 生SQL）→ Phase 2（既存の
     QueryBuilder を `note.id IN (:...candidateIds)` 付きで再利用）の
     ハイブリッド経路に入る
  3. Phase 2 の結果が `ps.limit` 未満なら、現行実装（Phase 1 を使わない
     素の QueryBuilder 版）にフォールバック
- 生SQL の実行には constructor に既に注入済みの `this.notesRepository`
  （`Repository.query(sql, params)`）を使う。新規 DI は不要
- Phase 2 は「現行の `query` 構築ロジック（155〜265行目）を関数として
  切り出し、`candidateIds` があれば `note.id IN (:...candidateIds)` を
  `andWhere` で追加する」形にすれば、フィルタロジックの二重メンテナンスを
  避けられる（Phase 1 用に複製する5関数相当の SQL 断片は、あくまで
  「粗く絞り込むための近似」であり、Phase 2 の QueryBuilder 呼び出しが
  最終的な正確性を担保する）

### 変更しないファイル（意図的）

- `packages/backend/src/core/QueryService.ts` — 触らない。フィルタ関数の
  仕様はそのまま利用する
- `packages/backend/src/core/FanoutTimelineEndpointService.ts` — 触らない
  （コンフリクト分析の結論どおり）
- migration — スキーマ変更なし。`(userId, id DESC)` 複合インデックスは
  既存の `IDX_a6f649630f55af3888e5a42919` を使う（新規インデックス不要、
  favskey で既に存在することを確認済み。develop 側にも存在するか
  実装時に再確認する）

## 実装ステップ（想定）

1. `getFromDb` の現行ロジックを `getFromDbDirect`（仮称）として
   温存しつつ、`getFromDb` を新しいディスパッチ関数に変更
2. Phase 1（LATERAL 生SQL、4パターンのうちまず「ユーザー・チャンネル
   両方フォロー」「ユーザーフォローのみ」の2パターンを実装。残り2パターン
   は元々 LATERAL 化の恩恵が薄いフォロー数少数ケースなので早期リターンで
   `getFromDbDirect` に委譲）
3. Phase 2（`getFromDbDirect` 相当のクエリ構築に `note.id IN (:...ids)`
   条件を追加できるようリファクタ）
4. Safety net（Phase 2 の結果件数チェック → 不足時 `getFromDbDirect`
   フォールバック）
5. 閾値（LATERAL 化する followees 件数の下限、Phase 1 の安全マージン倍率
   K）は最初は保守的な値にし、favskey の実データで EXPLAIN ANALYZE
   しながら調整する

## テスト方針

- 既存の `packages/backend/test/e2e/timelines.ts` にホームタイムラインの
  取得テストが既にあるはず（`fix/fanout-timeline` が260行追加している）。
  まずこれが green のまま保たれることを確認
- 新規テスト（TDD）:
  - フォロー数が閾値を超えるケースで、Phase 1/2 経由でも
    `getFromDbDirect` 直接呼び出しと**同じ結果集合**が返ることを検証
    （正確性の回帰テスト。isSuspended ユーザーの投稿を混ぜたケースを含む）
  - Phase 2 で limit 未満だった場合に safety net が発火し、最終的に
    正しい件数が返ることを検証（isSuspended を意図的に増やして
    マージン不足を起こすケース）
  - チャンネルフォロー併用ケース
- ローカル DB でフォロー数の多いテストフィクスチャを作り、
  EXPLAIN ANALYZE で実際に `(userId, id DESC)` インデックスが
  使われていることを確認（プラン形状のテストは vitest では難しいので
  手動確認 or ログ確認で代替）

## 検証（デプロイ後）

- favskey の auto_explain ログで、該当クエリの実行時間が
  1秒未満（Phase 1/2 経由）になっていること。8秒級の発生が消えること
- 特に `9vt5cndgmexj17w4`（658人フォロー、タイムマシン利用者）の体感が
  改善していること
- pg_stat_statements で `calls` が増えても `mean_exec_time` /
  `max_exec_time` が大幅に下がっていること
- 誤って投稿を取りこぼしていないか（正確性回帰）は上記ユニットテストで
  担保するが、本番でも一定期間 `allowPartial` 相当の欠落報告がないか
  注意する

## 未決事項（実装時に確定させる）

- [ ] LATERAL 化する followees 件数の閾値（初期案: 50）
- [ ] Phase 1 の安全マージン倍率 K（初期案: limit * 3）
- [ ] 「チャンネルフォローのみ」「フォローなし」パターンも LATERAL 化
      するか（恩恵が薄いため見送る可能性が高い）
- [ ] `packages/backend/src/core/QueryService.ts` の5関数の SQL を
      Phase 1 用に複製する際、コード生成の共通化（文字列テンプレート化）
      をどこまでやるか。過度な抽象化は避け、素直に生SQL文字列を組み立てる
      方針で良いか
