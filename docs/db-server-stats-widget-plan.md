# DB サーバーパフォーマンスウィジェット 実装計画

## 1. 目的とスコープ

アプリケーションサーバーとは別マシンで稼働している PostgreSQL について、CPU・メモリ・ストレージ残量・コネクション数などのリソース指標を Misskey の管理画面ウィジェットでリアルタイム表示できるようにする。

### 対象ユーザー
- DB を**自前ホスティング**しているフォーク版運用者
- マネージド DB（RDS / Cloud SQL 等）利用者は対象外（OS 指標が取れないため）

### 非スコープ（今回は作らない）
- 履歴を遡って分析する UI（既存の Server Metric ウィジェットと同様、ブラウザ側で定点スナップショットを積み上げる方式に揃える）
- Redis サーバーの監視（同じ仕組みで後追い可能だが本計画には含めない）
- レプリカ・マルチノード対応の収集と UI（運用実態としてレプリカを常用していないため、本計画では**プライマリ単独**を前提にする。詳細は §9）

---

## 2. 全体アーキテクチャ

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│ DB サーバー(別マシン)    │         │ アプリケーションサーバー        │
│                         │         │                              │
│  collect-stats.sh       │         │  DbServerStatsService        │
│  (systemd timer 60s)    │         │  ┌─────────────────────┐     │
│        │                │         │  │ 60s 間隔で SELECT    │     │
│        │ INSERT         │         │  │ → Xev emit           │     │
│        ▼                │ ◄───────┤  └─────────────────────┘     │
│  ┌──────────────────┐   │  SELECT │           │                  │
│  │ db_server_stats  │   │         │           ▼                  │
│  │ (PostgreSQL)     │───┼─────────┼─►  dbServerStats channel     │
│  └──────────────────┘   │         │  (WebSocket)                 │
│                         │         │                              │
│  purge-stats.sh         │         │           │                  │
│  (cron daily)           │         └───────────┼──────────────────┘
│        │ DELETE         │                     │
│        ▼                │                     ▼
└─────────────────────────┘            フロントエンド widget
                                       db-server-metric/
```

---

## 3. 収集データ

| 項目 | カラム | 型 | 取得元 |
|---|---|---|---|
| タイムスタンプ | `ts` | `timestamptz` PRIMARY KEY | スクリプト側で `now()` |
| ホスト識別子 | `host_id` | `text` | スクリプトに渡す環境変数（`hostname` でも可） |
| CPU 使用率 | `cpu` | `real` (0.0〜1.0) | `mpstat 1 1` か `/proc/stat` 差分 |
| メモリ使用量 | `mem_used` | `bigint` (bytes) | `/proc/meminfo` の `MemTotal - MemAvailable` |
| メモリ総量 | `mem_total` | `bigint` (bytes) | `/proc/meminfo` の `MemTotal` |
| ディスク使用量 | `disk_used` | `bigint` (bytes) | `df -PB1` の data_directory マウント点 |
| ディスク総量 | `disk_total` | `bigint` (bytes) | 同上 |
| ディスク I/O read | `disk_r_sec` | `bigint` (bytes/sec) | `/proc/diskstats` 差分 |
| ディスク I/O write | `disk_w_sec` | `bigint` (bytes/sec) | 同上 |
| DB サイズ | `db_size` | `bigint` (bytes) | `SELECT pg_database_size(current_database())` |
| アクティブコネクション | `conn_active` | `int` | `SELECT count(*) FROM pg_stat_activity WHERE state='active'` |
| 最大コネクション | `conn_max` | `int` | `SHOW max_connections` |
| キャッシュヒット率 | `cache_hit_ratio` | `real` (0.0〜1.0) | `pg_stat_database` から計算 |

---

## 4. コンポーネント別実装

### 4.1 テーブル DDL（マイグレーション）

**新規ファイル**: `packages/backend/migration/<timestamp>-DbServerStats.js`

```sql
CREATE TABLE "db_server_stats" (
    "ts"              TIMESTAMP WITH TIME ZONE NOT NULL,
    "host_id"         TEXT NOT NULL,
    "cpu"             REAL,
    "mem_used"        BIGINT,
    "mem_total"       BIGINT,
    "disk_used"       BIGINT,
    "disk_total"      BIGINT,
    "disk_r_sec"      BIGINT,
    "disk_w_sec"      BIGINT,
    "db_size"         BIGINT,
    "conn_active"     INTEGER,
    "conn_max"        INTEGER,
    "cache_hit_ratio" REAL,
    PRIMARY KEY ("ts", "host_id")
);
CREATE INDEX "IDX_db_server_stats_ts" ON "db_server_stats" ("ts" DESC);
```

`down()` では `DROP TABLE db_server_stats`。

### 4.2 収集スクリプト

**新規ファイル**: `scripts/db-server-stats/collect-stats.sh`（POSIX shell + `psql`）

要件：
- 環境変数で接続情報を受け取る（`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`、`MISSKEY_HOST_ID`）
- I/O 取得は前回値ファイル（`/var/lib/misskey-stats/last-diskstats`）との差分
- DB 接続用ロールは **INSERT 専用の最小権限**（後述「セットアップ」参照）
- 失敗時は stderr に出して終了（`set -eu`）

**新規ファイル**: `scripts/db-server-stats/purge-stats.sh`

```sh
psql -c "DELETE FROM db_server_stats WHERE ts < now() - interval '24 hours'"
```

**新規ファイル**: `scripts/db-server-stats/systemd/misskey-db-stats.service` および `.timer`

```ini
# misskey-db-stats.timer
[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
```

`.service` 側は `ExecStart=/path/to/collect-stats.sh`、`User=postgres`（または専用ユーザー）。

**新規ファイル**: `scripts/db-server-stats/README.md`
セットアップ手順（テーブル作成・ロール作成・systemd 配置・cron purge）を記載。

### 4.3 バックエンド：収集サービス

**新規ファイル**: `packages/backend/src/daemons/DbServerStatsService.ts`

`ServerStatsService.ts` を踏襲：
- `meta.enableDbServerStats` フラグで有効化
- `setInterval` で 60 秒ごとに `SELECT * FROM db_server_stats ORDER BY ts DESC LIMIT 1` を実行
- 取得した行を Xev で `dbServerStats` イベントとして emit
- 直近 200 件のログ配列も `serverStats` と同じ要領で保持（`requestDbServerStatsLog` への応答用）
- `OnApplicationShutdown` で `clearInterval`

クエリは TypeORM の DataSource を DI で受け取り、生 SQL で叩く（軽量）。

### 4.4 バックエンド：WebSocket チャンネル

**新規ファイル**: `packages/backend/src/server/api/stream/channels/db-server-stats.ts`

`server-stats.ts` を踏襲：
- `chName = 'dbServerStats'`
- **`requireCredential = true` かつ `requireModerator = true`**（重要：未認証ユーザーに DB の状態を見せない）
- `init()` で `ev.addListener('dbServerStats', this.onStats)`
- `onMessage('requestLog', ...)` で履歴取得

**変更ファイル**: `packages/backend/src/server/api/stream/ChannelsService.ts`（新チャンネルを登録）
**変更ファイル**: `packages/backend/src/boot/common.ts`（`DbServerStatsService.start()` を呼び出し）

### 4.5 バックエンド：meta 拡張

**変更ファイル**: `packages/backend/src/models/Meta.ts`

```ts
@Column('boolean', { default: false })
public enableDbServerStats: boolean;
```

**新規マイグレーション**: meta テーブルに `enableDbServerStats` カラム追加（`DbServerStats.js` と統合可）

**変更ファイル**: 管理 API（`admin/update-meta` 等）に `enableDbServerStats` 受付を追加

### 4.6 フロントエンド：ウィジェット

**新規ディレクトリ**: `packages/frontend/src/widgets/db-server-metric/`

- `index.vue`: ビュー切り替え（CPU+Mem / Disk Free / Connections）。`useStream().useChannel('dbServerStats')` で購読
- `cpu-mem.vue`: 既存 `server-metric/cpu-mem.vue` を流用しデータ源だけ差し替え
- `disk.vue`: **ディスク残量のゲージ**（`disk_used / disk_total`）と DB サイズ表示。今回のメイン
- `conn.vue`: アクティブコネクション数 / 最大コネクション数のゲージ
- `cache.vue`（任意）: キャッシュヒット率の折れ線

**変更ファイル**: `packages/frontend/src/widgets/index.ts`（or 同等のウィジェット登録箇所）に `dbServerMetric` を追加

**変更ファイル**: 該当ロケールファイル（`locales/ja-JP.yml` など）にウィジェット名・ラベル追加

---

## 5. 実装ステップ（推奨順）

1. **マイグレーション + meta 拡張** — テーブルと `enableDbServerStats` フラグを先に通す
2. **収集スクリプト + README** — DB 単体で stats が溜まる状態を作る（手動確認可能）
3. **DbServerStatsService** — アプリ側で SELECT して Xev に流す
4. **WebSocket チャンネル + ChannelsService 登録** — 開発者ツールで購読確認
5. **フロントウィジェット** — disk から先に実装（今回の主目的）、その後 cpu-mem / conn
6. **動作確認** — `enableDbServerStats=true` で起動、ウィジェット追加して値が更新されることを確認
7. **README 整備** — セットアップ手順を最終化

各ステップで commit を切る。

---

## 6. セットアップ手順（README に書く想定の内容）

DB サーバー側（postgres ユーザー想定）：

```sh
# 1. テーブルは Misskey マイグレーションで自動作成される（アプリ側を先に起動）

# 2. 収集用ロールを作成（INSERT のみ）
psql -c "CREATE ROLE misskey_stats LOGIN PASSWORD '...';"
psql -c "GRANT INSERT ON db_server_stats TO misskey_stats;"
psql -c "GRANT pg_monitor TO misskey_stats;"  # pg_stat_activity 等の閲覧用

# 3. スクリプト配置
sudo cp scripts/db-server-stats/collect-stats.sh /usr/local/bin/
sudo cp scripts/db-server-stats/systemd/* /etc/systemd/system/
sudo systemctl enable --now misskey-db-stats.timer

# 4. パージ cron 登録
echo "0 4 * * * /usr/local/bin/purge-stats.sh" | sudo crontab -u postgres -
```

アプリ側：管理画面で「DB サーバー統計を有効化」を ON にして、ウィジェットを追加。

---

## 7. 設計上の注意・既知の制約

- **収集スクリプト自身が 1 コネクション消費する** → `conn_active` に常に +1 のオフセットが乗る。誤差として許容。
- **DB ダウン時は何も見えない**（観測手段が観測対象に依存）。代替案として Redis 経由は検討したが、今回はスコープ外。
- **`db_server_stats` テーブル自体が `db_size` と `disk_used` を増やす** が、24時間 retention + 1 行 100B 程度なので無視できる規模。
- **CPU 取得のために sleep 1s が入る**（mpstat 方式）。スクリプト 1 実行あたり ~1.5s 程度を見込む。
- **チャンネルは管理者限定** にする。Misskey 既存の `server-stats` は誰でも見られるが、DB の内部状態は攻撃の手がかりになるため公開しない。

---

## 8. テスト方針

- **DDL マイグレーション**: up / down が通ること
- **収集スクリプト**: ローカル PostgreSQL に対して手動実行し、INSERT 成功を確認
- **DbServerStatsService**: ユニットテストは省略（既存 `ServerStatsService` も持たない）。手動で `enableDbServerStats=true` 起動して Xev emit をログ確認
- **チャンネル**: WebSocket クライアントで購読し `stats` メッセージが来ることを確認
- **ウィジェット**: 開発サーバーで追加し、値が 60 秒ごとに更新されること、disk free ゲージが正しい比率で描画されることを目視確認

---

## 9. 後で検討する項目（今回は実装しない）

- Redis サーバーの統計ウィジェット（同パターンで複製可能）
- 履歴グラフ（1時間/24時間）
- 閾値アラート（管理画面通知）
- Prometheus エクスポーター互換出力

### レプリカ／マルチノード対応について

運用実態としてレプリカを常用していないため、本計画では実装しない。ただし将来再検討する余地は残すため、以下のメモを残す：

- **テーブル側の準備は済んでいる**：`host_id` カラムは初版から含めるので、後からデータを増やすときマイグレーション不要。
- **書き込み経路**：レプリカは読み取り専用なのでローカルに INSERT できない。レプリカ機の収集スクリプトは**プライマリ DB に対して INSERT する**形になる（既存のレプリケーション接続と逆向きだが、実は streaming replication もレプリカ→プライマリへ TCP を張るので経路は既に存在）。
- **UI 要件**：複数ノードのデータを溜めても、ウィジェット側で**ノードを順送りで切り替えられるピッカー**がないと見えない。「データはあるが表示できない」状態は無意味なので、**UI を作らないなら収集も実装しない**という方針にする。
- **取得指標の住み分け**：プライマリで取れる DB-level 指標（`pg_database_size`, `cache_hit_ratio` など）はレプリカで取っても同値になるので、レプリカ機では OS 指標（CPU/Mem/Disk/I/O）+ レプリカ固有指標（`pg_last_wal_replay_lsn` 由来のラグ）に絞る形が筋。

---

## 10. 影響範囲まとめ

**新規ファイル**
- `packages/backend/migration/<timestamp>-DbServerStats.js`
- `packages/backend/src/daemons/DbServerStatsService.ts`
- `packages/backend/src/server/api/stream/channels/db-server-stats.ts`
- `packages/frontend/src/widgets/db-server-metric/`（5 ファイル）
- `scripts/db-server-stats/`（collect, purge, systemd unit, README）

**変更ファイル**
- `packages/backend/src/models/Meta.ts`
- `packages/backend/src/server/api/stream/ChannelsService.ts`
- `packages/backend/src/boot/common.ts`
- `packages/backend/src/server/api/endpoints/admin/update-meta.ts`（`enableDbServerStats` 受付）
- `packages/backend/src/server/api/endpoints/meta.ts`（フロントへ公開する場合）
- `packages/frontend/src/widgets/index.ts`（ウィジェット登録）
- `locales/ja-JP.yml`（ラベル）
