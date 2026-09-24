# resyncCharts タイムアウト修正計画（tickMajor のカウントだけ延長）

作成: 2026-07-22。チャートの note 総数が実態と乖離し続ける問題の根治。

## 問題の因果チェーン（調査済み・確定）

1. リモートノート削除（組み込み `CleanRemoteNotesProcessorService` / 手動 SQL とも）は
   raw DELETE のため、チャートのイベント減算 (`chart.update(note, false)`) を通らない。
   これ自体は設計どおり
2. その乖離は毎日 00:00 の `resyncCharts` ジョブが実カウントで補正する設計
   （`NotesChart.tickMajor` が `count(*)` で `local.total` / `remote.total` を上書き）
3. しかし Misskey はアプリの**全 DB 接続に `statement_timeout: 10秒`** を設定している
   （`packages/backend/src/postgres.ts:271`）。リモートノート 1,700万行超の
   `count(*)` は 10 秒で終わらず、**resyncCharts は毎日 10 秒で失敗**していた
   - 証拠: favskey の Bull ジョブ記録（Redis）で連日
     `canceling statement due to statement timeout`、processedOn→finishedOn が毎回ほぼ 10,000ms
4. `ResyncChartsProcessorService` は drive → notes → users を**直列 await** で回すため、
   notes で throw すると **users チャートの補正も道連れ**になる
5. 実測乖離（favskey, 2026-07-22): チャート remote.total 19,937,349 vs
   実カウント 17,743,939 = **+219万件の過大表示**。local はカウントが速く
   タイムアウト前に終わるため誤差 1 件

## 修正方針

`tickMajor` 系の実カウントクエリ**だけ** statement_timeout を延長する。
リポジトリ内の確立パターンを踏襲する:

```ts
// SearchService.ts:211-213 (お手本)
// 重い全文検索が DB を専有しないよう、トランザクション内で statement_timeout を 15s に縛る。
await em.query('SET LOCAL statement_timeout = \'15s\'');
```

`SET LOCAL` はトランザクション内でのみ有効なので、他のクエリ（通常リクエスト）の
10 秒制限には一切影響しない。

### 実装

1. **`Chart` 基底クラス（`core.ts`）にヘルパーを追加**:

   ```ts
   // tickMajor の実カウント用: 1日1回の resync 専用に statement_timeout を延長して実行
   protected async queryWithExtendedTimeout<T>(sql: string, params?: unknown[]): Promise<T> {
       return await this.db.transaction(async em => {
           await em.query('SET LOCAL statement_timeout = \'10min\'');
           return await em.query(sql, params);
       });
   }
   ```

   - `10min`: 日次ジョブなので余裕を持たせる。深夜帯実行 (00:00) であり
     count(*) が数十秒〜数分かかっても実害なし
   - 注意: `Chart` 基底は `db: DataSource` を既にコンストラクタで受けている
     （chart 各実装は super() に db を渡している）ので新規 DI は不要のはず。
     実装時に要確認

2. **resyncCharts が呼ぶ 3 チャートの `tickMajor` をヘルパー経由の raw SQL に置換**:

   | ファイル | 現在 | 置換後 |
   |---|---|---|
   | `charts/notes.ts` | `notesRepository.countBy({userHost: IsNull()})` ほか | `SELECT count(*) FROM note WHERE "userHost" IS NULL` 等を helper 経由で |
   | `charts/users.ts` | 同様の countBy × local/remote | 同上 |
   | `charts/drive.ts` | tickMajor の実クエリ（実装時に確認） | 同上 |

   - スコープはこの 3 つだけ（`ResyncChartsProcessorService` が resync するのは
     drive / notes / users のみ。`tickCharts` ジョブは全チャート `tick(false)` で
     tickMajor を呼ばない）
   - per-user / per-instance チャートの resync は upstream も TODO のまま
     （`ResyncChartsProcessorService` 内コメント参照）。本計画のスコープ外

3. **（検討・任意）resync の直列 await を per-chart try/catch にする**:
   1 つのチャートの失敗が残りを道連れにしない構造へ。上の修正で失敗自体は
   なくなる見込みだが、防御として入れる価値あり。入れる場合は失敗を
   logger.error で記録して続行

## やらないこと

- `pg_class.reltuples` による概算カウント化: 速いが概算。日次 1 回の正確な
  count が 10min 制限内で十分実行可能なため不採用
- `postgres.ts` のグローバル statement_timeout 変更: 影響範囲が全クエリに
  及ぶため触らない
- チャートの仕組み自体（イベント積算 + 日次補正）の変更: upstream 設計を維持

## テスト・検証

1. `pnpm lint` / backend unit テスト（`test/unit/chart.ts` が既存。resync 経路の
   テストがあるか実装時に確認し、可能なら「tickMajor が transaction 経由で
   実行される」ことのテストを追加）
2. migration なし・API 変更なし → check-migrations / misskey-js 再生成は不要
3. `CHANGELOG.md` の `### Server` に Fix を 1 行
4. **デプロイ後の実地検証**（favskey が最適 = 乖離 219万件の現場）:
   - resyncCharts の次回実行後、Bull ジョブ記録に failedReason が無いこと
   - 乖離確認クエリ（チャート最新行 vs 実カウント）:
     ```sql
     SELECT date, "___local_total", "___remote_total"
       FROM "__chart__notes" ORDER BY date DESC LIMIT 1;
     SELECT count(*) FILTER (WHERE "userHost" IS NULL),
            count(*) FILTER (WHERE "userHost" IS NOT NULL) FROM note;
     ```
   - 期待値: remote.total と実カウントの差が「前回 resync 以降の削除数」程度まで縮む

## 即応の手当て（修正デプロイを待たない場合・任意）

`__chart__notes`（hour / day 両方）の最新行 `___remote_total` を実カウントに
UPDATE すれば即座に表示が直る。以降のバケットは最新行から引き継ぐため、
新規乖離だけが再蓄積 → 修正デプロイ後の resync で恒久解消、という流れにできる。

## ブランチ・展開

- `fix/resync-charts-timeout` を origin/develop から作成（/worktree 利用）
- 実装時は working-on-backend スキル、仕上げは shipping-misskey-change スキルを通す
- **upstream 貢献候補**: 大規模インスタンス一般で起きうる問題
  （remote notes cleaning が入った今、同じ乖離が upstream でも発生する）。
  マージ後に upstream PR を検討 → creating-issues-and-prs スキル参照
- 3 インスタンスとも同じ問題を抱えている（favskey で確定、他 2 台も
  クリーナー稼働 + 10s timeout は共通）ため、MISTEMS 経由で全台に展開
