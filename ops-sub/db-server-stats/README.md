# db-server-stats

Misskey の **DB サーバーパフォーマンスウィジェット** が表示する統計を、PostgreSQL が動いているマシンの上で収集して `db_server_stats` テーブルに INSERT するためのツール群。

> このディレクトリは **`ops-sub/`**（= ホスト以外で動く運用補助物）の配下にあります。`scripts/` は pnpm から呼ばれる Node 製ビルドスクリプト専用なので、こちらを混ぜていません。

## 構成

```
db-server-stats/
├── bin/                       本体（実際に動くスクリプト）
│   ├── collect-stats.sh       OS 指標 + DB 指標を 1 行 INSERT
│   └── purge-stats.sh         古い行を DELETE
└── setup/                     セットアップツール（定期実行の登録例）
    ├── systemd/               オプション A: systemd timer
    │   ├── misskey-db-stats.service
    │   ├── misskey-db-stats.timer
    │   ├── misskey-db-stats-purge.service
    │   └── misskey-db-stats-purge.timer
    └── crontab.example        オプション B: cron で済ませる場合
```

## セットアップ

### 1. アプリ側を先に起動して、テーブルを用意する

`db_server_stats` テーブルは Misskey のマイグレーションで自動作成されます。アプリを最新版に更新して起動してください。同時に `meta` テーブルに `enableDbServerStats` カラムが追加されます（既定 `false`）。

### 2. 収集用のユーザーとロールを作成（DB サーバー側、root で）

収集は DB サーバーの中で動くので、OS ユーザー `misskey_stats` と同名の DB ロールを作り、Unix ソケットの **peer 認証** でつなぐのを第一の案にする。パスワードを環境ファイルに置かずに済む。

#### 2-A. peer 認証（推奨）

```sh
sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin misskey_stats
sudo -u postgres psql -c "CREATE ROLE misskey_stats LOGIN;"
sudo -u postgres psql -d misskey -c "GRANT SELECT, INSERT, DELETE ON db_server_stats TO misskey_stats;"
sudo -u postgres psql -c "GRANT pg_monitor TO misskey_stats;"  # pg_stat_activity, pg_database_size 等の閲覧用
```

`pg_hba.conf` の `local` の行が peer になっているかを確かめる。Ubuntu の既定は peer だが、`md5` や `scram-sha-256` になっている環境もある。`misskey_stats` が最初に当たる `local` の行が peer でなければ、その行より上に次の 1 行を足して、PostgreSQL に設定を読み直させる（`sudo systemctl reload postgresql`）。

```
local   misskey   misskey_stats   peer
```

確かめ方:

```sh
sudo -u postgres psql -Atc "SELECT line_number, database, user_name, auth_method FROM pg_hba_file_rules WHERE type = 'local' ORDER BY line_number"
sudo -u misskey_stats psql -h /var/run/postgresql -d misskey -c "SELECT count(*) FROM db_server_stats"
```

#### 2-B. パスワード認証（peer が使えないとき）

```sh
sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin misskey_stats
sudo -u postgres psql -c "CREATE ROLE misskey_stats LOGIN PASSWORD '...';"
sudo -u postgres psql -d misskey -c "GRANT SELECT, INSERT, DELETE ON db_server_stats TO misskey_stats;"
sudo -u postgres psql -c "GRANT pg_monitor TO misskey_stats;"
```

### 3. 本体スクリプトを配置

```sh
sudo install -m 755 bin/collect-stats.sh /usr/local/bin/
sudo install -m 755 bin/purge-stats.sh   /usr/local/bin/
```

### 4. 環境変数ファイルを作成

2-A（peer 認証）の場合。秘密を含まない。

```sh
sudo tee /etc/misskey-db-stats.env >/dev/null <<'EOF'
PGHOST=/var/run/postgresql
PGUSER=misskey_stats
PGDATABASE=misskey
MISSKEY_HOST_ID=primary
# MISSKEY_DATA_DIR=/var/lib/postgresql   # ディスク使用量を測るマウント点
# MISSKEY_STATS_RETENTION=24 hours       # purge の保持期間
EOF
sudo chmod 644 /etc/misskey-db-stats.env
```

2-B（パスワード認証）の場合は `PGHOST=127.0.0.1` と `PGPASSWORD=...` にして、ほかの人が読めないようにする。

```sh
sudo chmod 600 /etc/misskey-db-stats.env
sudo chown root:root /etc/misskey-db-stats.env   # systemd が root で読んでから User= に切り替えるので、root だけが読めればよい
```

### 5-A. systemd timer で定期実行

```sh
sudo cp setup/systemd/*.service setup/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now misskey-db-stats.timer
sudo systemctl enable --now misskey-db-stats-purge.timer
```

確認：

```sh
systemctl list-timers misskey-db-stats*
journalctl -u misskey-db-stats.service -n 20
```

### 5-B. cron だけで済ませる場合

`setup/crontab.example` を参考に `crontab -u misskey_stats -e` で登録する。最小粒度が 1 分なので、30 秒間隔で集めたい場合は systemd を選ぶ。

cron では systemd の `StateDirectory=` が使えないので、前回値の置き場を先に作っておく（`sudo install -d -o misskey_stats -g misskey_stats -m 755 /var/lib/misskey-stats`）。

### 6. アプリ側で機能を有効化

管理画面の「パフォーマンス」で「DBサーバーの統計を表示する」をオンにする（または直接 meta テーブルの `enableDbServerStats` を更新）。再起動は要らない。`DbServerStatsService` は、ウィジェットを開いている人がいる間だけ `db_server_stats` テーブルを 30 秒間隔で SELECT し、新しい行があればウィジェットに配信する。ウィジェットを開いたときの履歴も、このテーブルから読む。

### 7. ウィジェットを追加

管理者アカウントで Misskey にログインし、ウィジェット追加メニューから **「DB サーバーメトリクス」** を選ぶ。チャンネルはモデレーター権限がないと購読できないので、一般ユーザーには見えない。

## トラブルシューティング

- **何も表示されない** → `journalctl -u misskey-db-stats.service` で収集が走っているか確認。`SELECT count(*) FROM db_server_stats` が 0 でないか。
- **disk_r_sec / disk_w_sec が NULL のまま** → `MISSKEY_DATA_DEV` を明示的に指定（例: `nvme0n1`）。`/proc/diskstats` から読める名前を `cat /proc/diskstats` で確認。
- **`mkdir: cannot create directory '/var/lib/misskey-stats'`** → 実行ユーザーが前回値の置き場を作れていない。systemd なら unit に `StateDirectory=misskey-stats` があるかを確かめる（同梱の unit には入っている）。cron なら上のとおり先に作る。
- **`Peer authentication failed`** → `pg_hba.conf` の `local` の行が peer になっていないか、OS ユーザー名と DB ロール名が違う。2-A の確かめ方を参照。
- **アプリ側ログに DB エラー** → `pg_monitor` 権限が付与されているか、`misskey_stats` ロールの接続情報が正しいかを確認。
- **テーブルが太ってきた** → `purge-stats.sh` の `MISSKEY_STATS_RETENTION` を短めに（例: `12 hours`）。

## 設計メモ

- 本スクリプトは **単発実行**（常駐しない）。1 回呼ばれて 1 行 INSERT して終わる。スケジューラ非依存。
- CPU 使用率取得のため `sleep 1` が入る（`/proc/stat` 差分）。1 実行あたり 1.5 秒程度を見込む。
- ディスク I/O は `/proc/diskstats` の前回値（`/var/lib/misskey-stats/last-diskstats`）との差分。置き場は unit の `StateDirectory=` で systemd が作る。初回実行時は `NULL`。
- `db_size` には本テーブル自身の使用量も含まれるが、24 時間 retention + 1 行 ~100B 程度なので無視できる。
- DB ダウン時は INSERT も SELECT も失敗する（観測手段が観測対象に依存）。「最後の値が残っていれば十分」という割り切り。
