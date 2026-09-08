# DB パフォーマンス観察記録 — systems-db1 / gamelore-db2 / favskey-db1

- 実施日時: 2026-07-28 00:15〜00:40 JST ごろ
- 実施方法: **完全に読み取りのみ**（psql の SELECT / pg_settings / pg_stat_* と papertrail 検索のみ。設定変更・VACUUM・リセット等は一切なし）
- 統計の観測窓: pg_stat_bgwriter の stats_reset が 3 台とも 2026-07-20 なので、**約 7.4 日分**の累積統計として読む

## 割り引いて読む事項（本人申告のチョンボ込み）

1. **7/27 23:00 ごろにタイムラインのクエリ組み立てが変更された** — papertrail の直近のスロークエリ/タイムアウトの山はこの影響圏
2. **観察直前に手動 ANALYZE を実行済み** — それまで大テーブルにオートバキューム/オートアナライズがほぼ走っていなかった。`last_autoanalyze` の新しい時刻は手動実行の痕跡
3. pg_stat_statements は約 1 週間の累積なので、23:00 の変更前のクエリ形も混在している

---

## 観察手順

```
# 接続確認（ホスト名の正解を探すところから始まった。詳細は日記参照）
ssh systems-db1 "psql -d misskeydb"   # ※ mistems-db1 ではない
ssh gamelore-db2 "psql -d misskeydb"  # ※ DB 名は misskey ではなく misskeydb
ssh favskey-db1  "psql -d misskey"    # ※ こっちは misskey

# 観察クエリ一式（読み取りのみ）を流す
# 内容: version / DB サイズ / pg_settings (non-default + 主要項目) /
#       キャッシュヒット率 / テーブル・インデックスサイズ Top20 /
#       seq scan 多発テーブル / 未使用インデックス / dead tuple とautovacuum /
#       bgwriter・checkpoint / 接続状態 / pg_stat_statements Top20 / WAL 統計
ssh <host> "psql -d <db> -X" < observe.sql > <host>.txt

# OS リソース
ssh <host> "nproc; free -h; df -h /; uptime"

# papertrail（アプリログ側）
papertrail --min-time '24 hours ago' "query is slow" | wc -l        # → 718 件
papertrail --min-time '24 hours ago' "statement timeout" | wc -l    # → 1,056 件
papertrail -j --min-time '3 hours ago' "statement timeout" | (source別集計)  # → gamelore 935 件

# アプリ側の突き合わせ
# candidate_notes クエリの出所をコードベースから grep → CleanRemoteNotesProcessorService
# meta テーブルから cleanRemoteNotes の設定値を SELECT
```

---

## サーバープロファイル

| 項目 | systems-db1 | gamelore-db2 | favskey-db1 |
|---|---|---|---|
| CPU / RAM | 4 core / 7.7 GB | 4 core / 11 GB | **2 core / 3.8 GB** |
| ディスク | 169 GB (81% 使用, 残 33 GB) | 244 GB (60% 使用, 残 95 GB) | **94 GB (87% 使用, 残 12 GB)** |
| PostgreSQL | 15.17 (pgdg/22.04) | 15.15 (pgdg/22.04) | 16.14 (Ubuntu 24.04) |
| DB サイズ | 114 GB | 123 GB | 66 GB |
| shared_buffers | 2 GB | 2.5 GB | 1 GB |
| effective_cache_size | 6 GB | 8 GB | 2.8 GB |
| work_mem | 16 MB | 16 MB | 8 MB |
| maintenance_work_mem | 64 MB | **512 MB** | 64 MB |
| checkpoint_timeout / max_wal_size | 300s / 1 GB | 900s / 2 GB | 300s / 1 GB |
| synchronous_commit | **off** | on | on |
| track_io_timing | on | off | off |
| キャッシュヒット率 | 99.57% | 96.42% | 97.65% |
| 特記 | auto_explain 1s 設定あり | レプリケーションスロット `misskey_replication` 設定あり・max_conn 150 | 最小構成で 66 GB を背負う |

3 台とも load average は 0.2 前後で、観察時点の瞬間負荷は平和そのもの。問題は瞬間負荷ではなく累積の内訳にある。

---

## 結果: 主要な発見

### 発見 1: 「リモートノート掃除ジョブ」が DB 時間の王者（3 台共通・最重要）

pg_stat_statements の実行時間合計 1 位は 3 台とも同じクエリ、`WITH RECURSIVE "candidate_notes"` — 出所はコードベースの `CleanRemoteNotesProcessorService`（リモートノートのクリーンアップ）だった。

| | 全 DB 時間に占める割合 | 呼び出し回数 | 平均時間 | 累積 (7.4日) |
|---|---|---|---|---|
| systems-db1 | **80.0%** | 9,079 | **10.4 秒** | 26.1 時間 |
| gamelore-db2 | 37.7% | 25,718 | 1.1 秒 | 8.1 時間 |
| favskey-db1 | **85.0%** | 21,887 | 2.4 秒 | 14.7 時間 |

設定は 3 台とも同一（meta テーブルより）: 有効・毎日 04:00 起動・最長 360 分・90 日より古いリモートノートが対象。つまり **毎日最大 6 時間、systems では 1 バッチ平均 10 秒の再帰 CTE を回し続けている**。日割りすると systems は毎日約 3.5 時間ぶんの DB 時間をこのジョブだけで消費している計算になる。

深夜帯なのでユーザー影響は限定的だが、次の副作用が観察と符合する:

- ノート削除が毎日大量の dead tuple を作る（→ 発見 2 と結合）
- systems だけ平均が 10 倍遅い（note 4,500 万行 + ピン留め/お気に入り/ローカルリアクションの NOT EXISTS ×3 サブクエリ）。バッチサイズ（LIMIT）と統計の鮮度で効率が大きく変わる形のクエリ

### 発見 2: オートバキュームが大テーブルに構造的に届かない（3 台共通）

`autovacuum_vacuum_scale_factor` が 3 台ともデフォルトの 0.2 のまま。つまり note テーブル（3,800万〜4,500万行）は **dead tuple が 700 万〜900 万行溜まるまでバキュームされない**。観察された実態:

- gamelore: note の dead 536 万 (12.2%)、note_reaction の dead 377 万 (7.8%) — どちらも `autovacuum_count = 0`
- favskey: note の dead 191 万 (10.1%) — `autovacuum_count = 0`
- systems: note_reaction の dead 129 万 (7.5%) — `autovacuum_count = 0`

「走っていなかった」のではなく「**設定上、まだ走る条件に達していない**」が正体。閾値に達する頃には数百万行の掃除を 64 MB の maintenance_work_mem（systems/favskey）でやることになり、1 回のバキュームが重く長くなる悪循環の形。発見 1 の掃除ジョブが毎日 dead tuple を量産するので、この 2 つはセットで効いている。

### 発見 3: ゴミと肥大化の在庫一覧

非破壊観察なので数えただけ。回収は計画側に記載。

| サーバー | 対象 | サイズ | 中身 |
|---|---|---|---|
| gamelore | **note_unread テーブル + 索引 5 本** | **約 5.6 GB** | **行数 0**。生ける屍。テーブル 2.4 GB + 未使用インデックス 5 本 (約 930 MB) + 残りは過去の膨張分 |
| favskey | user."updatedAt" インデックス | **908 MB** | idx_scan = 0。user は 28 万行なので健全なら 10 MB 程度のはず。約 90 倍の肥大化 |
| 3 台とも | drive_file (uri) インデックス | 1.0〜1.5 GB × 3 台 | idx_scan = 0。ただし AP 連携で稀に使われる可能性があり、落とす前に要調査 |
| 3 台とも | hashtag 系インデックス 4 本 | 各 11〜17 MB | idx_scan = 0 |
| gamelore | bubble_game_record | 111 MB | **живых 52 行**。バブルゲームの栄光の跡地 |

ざっくり、**gamelore は 8 GB 前後、favskey は 2.5 GB 前後、systems は 1.5 GB 前後**が「使われていない領域」として観察された。残りディスク 12 GB の favskey にとっては貴重な量。

### 発見 4: stats 系 COUNT クエリがタイムアウト常連

papertrail に `Internal error occurred in stats: canceling statement due to statement timeout` が出ている。突き合わせると:

- favskey: `SELECT COUNT(*) FROM note WHERE userHost IS NOT NULL` が **1 回 82 秒**（12 回で 986 秒）
- systems: 同型のクエリが 1 回 52 秒
- 3 台とも `SELECT COUNT(*) FROM note_reaction` が 4.5〜12 秒

nodeinfo / stats エンドポイント由来の全件 COUNT。数千万行の実カウントは原理的に勝てないので、推計値 (`pg_class.reltuples`) かキャッシュ側で解決する種類の問題。favskey の note_reaction は seq_scan 累計 2 万回・**読んだタプル累計 189 億**という値を叩き出しており、これが主犯。

### 発見 5: conf の見直し候補（サーバー別の凸凹が大きい）

3 台で設定思想がバラバラなのがそのまま観察に出た:

- **effective_io_concurrency = 1（3 台とも）**: SSD なら 100〜200 が定石。random_page_cost=1.1 に直した形跡はあるのにこちらは素通しされている
- **wal_compression = off（3 台とも）**: WAL の 30〜35% が full page image（favskey は 75 GB 中 FPI が大半）。圧縮で WAL 量とディスク書き込みをかなり削れる
- **favskey: wal_buffers 16 MB で `wal_buffers_full` が 94,381 回** — WAL バッファ溢れが常態化。増量候補筆頭
- **gamelore: bgwriter が限界稼働** — `maxwritten_clean` 66,639 回（1 周期の書き出し上限に達した回数）。backend 自身によるバッファ書き出し 956 万回はチェックポイント経由 (280 万) の 3 倍超。shared_buffers 増と bgwriter_lru_maxpages 増の検討材料
- **systems: synchronous_commit = off** — 意図した設定なら性能面は正しい選択（クラッシュ時に直近コミット数百 ms を失い得るトレードオフ）。gamelore/favskey は on のままなので、思想を揃えるか意図を記録しておきたい
- **maintenance_work_mem 64 MB（systems/favskey）**: 数百万 dead tuple のバキュームには小さすぎる。gamelore だけ 512 MB
- **track_io_timing off（gamelore/favskey）**: 観察力に直結するのに off。オーバーヘッドは実測でほぼ無視できる量
- **log_min_duration_statement**: systems -1（無効・auto_explain 1s のみ）、gamelore 10 秒、favskey -1。閾値がバラバラで横比較しにくい

### 発見 6: PostgreSQL 移行（メジャーアップグレード）の効果見込み

2026 年 7 月時点の最新: **18.4 / 17.10 / 16.14 / 15.18**（PG19 は beta2）。

| サーバー | 現在 | マイナー遅れ | メジャー移行の妙味 |
|---|---|---|---|
| systems-db1 | 15.17 | 1 個 (→15.18) | 大きい |
| gamelore-db2 | 15.15 | 3 個 (→15.18) | 大きい |
| favskey-db1 | 16.14 | 最新 | 中くらい |

PG15 → 17 以降で今回の観察結果に直接効く改善:

- **PG17: VACUUM のメモリ管理刷新（adaptive radix tree）** — 数百万 dead tuple の回収が速く・省メモリになる。発見 2 の悪循環に直撃で効く
- **PG17: ストリーミング I/O による順次読み込み高速化** — COUNT 系フルスキャン（発見 4）と掃除ジョブのスキャンに効く
- **PG16: 並列集約・btree 改善**、IN リスト多用の Misskey クエリに効く btree 複数値検索改善も 17 系
- **PG18: 非同期 I/O (io_method=worker)** — クラウド VM のストレージレイテンシ隠蔽に効くが、まだ .4 なので急がなくてよい

PG15 の EOL は 2027 年 11 月なので時間はあるが、「バキューム地獄への構造対策」として PG17 化は チューニングというよりアーキテクチャ改善に近い費用対効果がある。

---

## papertrail 所見

- 直近 24 時間: `query is slow`（アプリ側スロークエリログ）718 件、`statement timeout` 1,056 件
- ただし timeout のうち **935 件は直近 3 時間の gamelore に集中** — 7/27 23:00 のタイムラインクエリ変更と、ANALYZE 前の統計の古さが重なった期間なので、恒常値としては読まない（申告どおり割引）
- 割引後も残る恒常成分: stats エンドポイントの COUNT タイムアウト（発見 4）、INSERT INTO note が単発で 1.2 秒かかるケース（書き込みスパイク時のチェックポイント/WAL 詰まりが疑い先。発見 5 の wal 系設定と関係している可能性）

---

## チューニング計画（案）— 全部まだ「やっていない」こと

観察は非破壊で完了したので、以下は優先度順の提案リスト。

### フェーズ 0: 追加観察（引き続き非破壊）

1. gamelore/favskey で `track_io_timing = on`（これだけは変更を伴うが実質無害）にして I/O 時間の内訳を取れるようにする
2. 手動 ANALYZE 後の candidate_notes クエリの平均時間を数日分観測（統計の鮮度でどれだけ変わるかの確認）
3. 7/29 以降の papertrail で timeout 恒常値を再計測（23:00 変更の影響を除いた基準線づくり)
4. drive_file(uri) インデックスが本当に不要か、AP 連携コードの参照経路を確認

### フェーズ 1: 設定変更のみ（再起動なし or reload で済むもの中心）

| 設定 | 対象 | 現在 → 提案 |
|---|---|---|
| autovacuum_vacuum_scale_factor | note, note_reaction 等の大テーブルに **per-table 設定** | 0.2 → 0.01〜0.02 |
| maintenance_work_mem | systems, favskey | 64 MB → 256〜512 MB |
| effective_io_concurrency | 3 台 | 1 → 200 |
| wal_compression | 3 台 | off → lz4 (PG15+) |
| wal_buffers | favskey | 16 MB → 64 MB |
| bgwriter_lru_maxpages | gamelore | 100 → 400 前後 |
| track_io_timing | gamelore, favskey | off → on |
| log_min_duration_statement | 3 台 | 1〜3 秒に統一 |

### フェーズ 2: アプリ・運用側

1. **cleanRemoteNotes の設定調整**: 最長 360 分 → 短縮、または expiry 90 日の見直し。systems は 1 バッチ 10 秒の原因調査（EXPLAIN ANALYZE を深夜帯に 1 回だけ取る）
2. **stats 系 COUNT の推計値化**: `reltuples` ベースまたはキャッシュ化（上流にも同種の議論あり。MISTEMS パッチ候補）
3. 手動 VACUUM (通常の、FULL でない) を大テーブルに 1 回ずつ実施して基準線を作る

### フェーズ 3: 回収と移行（要メンテナンス告知）

1. gamelore の note_unread 5.6 GB: 空テーブルの確認後 TRUNCATE + 未使用インデックス削除で即回収
2. favskey の user."updatedAt" インデックス 908 MB: `REINDEX CONCURRENTLY`（無停止可）
3. PG15 → 17 移行（systems, gamelore）: `pg_upgrade --link` なら停止は数分オーダー。バキューム改善が本命
4. マイナーアップデート（15.15/15.17 → 15.18）は次回メンテのついでに

---

## 気になる項目（未解明のまま残したもの)

- systems の candidate_notes だけ平均 10.4 秒と桁違いに遅い正確な理由（行数だけでは説明しきれない。EXPLAIN 待ち）
- instance テーブルへの seq scan が 3 台とも多い（systems: 11,929 回で累計 1.56 億タプル）。連合先メタデータの参照経路にインデックスが効いていない箇所がありそう
- gamelore の絵文字クエリ: 36,180 回の呼び出しで**累計 2.49 億行**を返している（1 回あたり約 6,900 行）。絵文字キャッシュのリフレッシュ頻度か取得単位に見直し余地がありそう
- gamelore にレプリケーションスロット `misskey_replication` が設定されているが、レプリカは今も生きているのか（スロットが放置されていると WAL が溜まり続ける事故の種）
- favskey のディスク残 12 GB (87%) はチューニング以前に容量計画の問題

---

## 日記

深夜 0 時すぎ、3 台の DB を「見るだけ」ツアーに出発。まず `mistems-db1` が存在しないことが判明して初手からつまずく。正解は `systems-db1`。さらに DB 名が systems/gamelore は `misskeydb`、favskey だけ `misskey` という微妙な揺れがあり、インフラの歴史の地層を感じる。ついでに gamelore だけサーバー時計が JST で他 2 台は UTC ということにも気づいた（uptime の表示時刻が 9 時間ズレていた）。

今夜いちばんの見せ場は、実行時間ランキング 1 位のクエリの正体探し。3 台とも同じ `WITH RECURSIVE candidate_notes` という巨大な再帰 CTE が王座に鎮座しており、systems に至っては全 DB 時間の 8 割。タイムラインの新機能か何かかと思ってコードベースを grep したら、正体は**お掃除ジョブ**だった。リモートノートを毎日コツコツ消して回る係が、DB でいちばんの働き者（悪く言えば大飯食らい）だったというオチ。しかもこの係が毎日量産する dead tuple を、デフォルト設定のオートバキュームは「まだ 20% 溜まってないから」と見て見ぬふり。掃除係が散らかして、掃除機が動かない。役所みたいな話である。

gamelore では行数 0 なのに 5.6 GB を占有する note_unread テーブルという幽霊物件を発見。インデックス 5 本を従えて堂々たる佇まいだった。favskey では 28 万行のテーブルに 908 MB のインデックス（本来の 90 倍サイズ）という力士のような物件も。そして bubble_game_record、52 行で 111 MB。1 行あたり 2 MB の超高級レコードである。かつての熱狂の跡地に礎石だけが残っている。

途中でオーナーから「23 時にタイムラインのクエリ変えたのと、さっき ANALYZE かけ直したのは割り引いてね、ごめんよ」という自首があった。papertrail のタイムアウト 935 件/3h の山はこれでだいたい説明がつく。観察者としては「現場を荒らされた」形だが、自首があると調書が書きやすいので助かる。

総括すると、3 台とも瞬間負荷は平和（load average 0.2）で、ユーザーが今すぐ困る状態ではない。問題はすべて「累積」と「デフォルト設定のまま大きくなった」系。チューニングというより、大きくなった子供に合うサイズの服を買ってあげるフェーズ、という印象だった。

参考: PostgreSQL の最新バージョン確認は [postgresql.org のリリースノート](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/) と [Release Notes 一覧](https://www.postgresql.org/docs/release/) による。

---

## 追記 (2026-07-28 深夜) — その夜のうちに完結した話

観察レポートを書き終えた直後から作業が始まり、同じ夜のうちにフェーズ 1〜3 の大半が消化された。カジュアル運用の底力である。

### 実施されたこと（オーナー作業・検収済み）

1. **track_io_timing を 3 台とも on に**（ついでに再起動）。次回の 04:00 掃除ジョブから I/O 時間の内訳が取れる
2. **フェーズ 1 の conf 変更一式を適用**
3. **note_unread テーブルを 3 台ともドロップ** — 事前調査で書き込み停止を確認（コード参照ゼロ、最終書き込みは aid 復号で systems 2025-03-24 / gamelore 2025-04-04 / favskey 2025-09-14）。gamelore の DB は 123 GB → 117 GB、ディスク残 95 → 99 GB
4. **user."updatedAt" インデックスを 3 台とも REINDEX CONCURRENTLY** — favskey 908 MB → 5.4 MB、systems 1,065 MB → 6.6 MB、gamelore 1,289 MB → 7.9 MB。合計約 3.2 GB → 20 MB
5. gamelore のレプリカ廃止を確認 — スロットは既に存在せず WAL 滞留なし。残るは conf の化粧直しのみ

回収合計は約 9 GB。

### 訂正 2 件（どちらも「analyze ガバ」が犯人）

- **gamelore の note_unread「行数 0」は誤り** — 実カウントは 2,633 万行だった。n_live_tup が analyze 不足で 0 を返していた。撤去済み機能の既読データなので価値ゼロという結論は変わらず、ドロップで正解
- **bubble_game_record「52 行で 111 MB」は冤罪** — 実カウントは 67,684 行、最新 ID は当日。1 行約 1.6 KB はリプレイログ入りとして正常なサイズで、膨張ではなく現役の人気者だった。VACUUM FULL が効かなかったのは、そもそも痩せる贅肉がなかったから。日記のハイライト「1 行 2 MB の超高級レコード」はここに取り下げる。バブルゲームは今日も遊ばれている

### 新たに判明した構造問題（本命の宿題）

user."updatedAt" インデックスの肥大は 3 台共通の構造問題だった。ノート投稿ごとに走る `UPDATE user SET updatedAt=..., notesCount=...` に対し、updatedAt に上流の `@Index()` が付いているため **HOT update が全滅**（実測 HOT 率 2.2〜4.4%）し、user の全インデックスが毎回書かれる。REINDEX は対症療法なのでまた育つ。根治はインデックス撤去（用途はほぼ admin のユーザー一覧ソートのみ）で、MISTEMS パッチ・上流 PR の題材候補。再肥大の速度を数週間観測してから判断する。

### 残タスク

- [ ] stats 系 COUNT の推計値化（gamelore で 216 件/90 分のタイムアウト源）
- [x] systems の candidate_notes が 1 バッチ 10 秒な理由の解明 → 追記 2 参照（Merge Anti Join の踏み外し）
- [ ] updatedAt インデックスの再肥大速度の観測 → 撤去パッチの判断（15 時間で +2〜3 MB、月 1 REINDEX で管理圏内）
- [ ] gamelore の conf からレプリケーション設定の残骸を掃除（実害なし・化粧直し）
- [ ] PG15 → 17 移行計画（systems / gamelore）※ systems には PG17 クラスタが 2025 年 10 月からインストール済みで眠っている
- [ ] favskey のディスク容量計画（残 13 GB）
- [x] **5432 番ポートの外部公開を閉じる** → Vultr Cloud Firewall で対応済 (2026-07-28 16 時台)。5432 は各 app サーバー IP のみ許可、外部遮断を nc で検収済。なお適用直後、ssh の実ポートが 22 ではなく 8022 だったため全台締め出しの一幕あり（コンソールから 8022 ルール追加で即復旧）。ファイアウォールを張るときは sshd の実ポートを先に確認すること

---

## 追記 2 (2026-07-28 16 時台) — 効果測定と、2 つの謎解きと、1 つの招かれざる客

Phase 1 適用から約 15 時間後（04:00 の掃除ジョブが track_io_timing 有効で 1 周した後）の再観測。

### 効果測定: ほぼ全戦果

- **statement timeout: 直近 6 時間で全ホスト 0 件**（悪化時 935 件/3h、改善前の恒常値でも 216 件/90 分あった）。`query is slow` も 6h で 12〜56 件と平穏
- **オートバキューム覚醒**: scale_factor 0.01 で大テーブルが初回バキューム完了。note の dead tuple は systems 109 万→8,889 / gamelore 536 万→23 万 / favskey 191 万→8.1 万
- **favskey の WAL バッファ溢れ停止**: wal_buffers 64 MB 化以降 `wal_buffers_full` が 1 件も増えていない。キャッシュヒット率 97.65→98.18%（累積値でこれなので直近はさらに上）
- **updatedAt インデックス再肥大は緩やか**: 15 時間で +0.9〜3 MB。月 1 REINDEX で管理圏内、根治パッチは急がない
- 気になる点: gamelore の buffers_backend が 15 時間で +740 万。深夜の大規模メンテ由来の一過性と判断、次回確認

### 謎解き 1: candidate_notes の 10 秒の正体（auto_explain のプランで確定）

JIT は無罪だった（COUNT クエリ側で 20〜40 ms 程度）。真犯人はプランナーの Join 選択ミス。実プラン（20.7 秒の例）の内訳:

- note の ID 範囲スキャン自体は **110 行・403 ms** で終わっている
- ところが「ローカルユーザーがリアクションしたノートを除外する」NOT EXISTS を **Merge Anti Join** で実行しており、その内側で **note_reaction 331 万行のスキャン + user への 331 万回の PK ルックアップ（19.7 秒、バッファ 1,547 万ヒット）** が発生。たった 110 行の候補と突き合わせるためにである
- 原因は note 範囲スキャンの行数見積もりが **2,600 万行（実際は 110 行）** と大外れしていること。再帰部分（SubPlan 5）では同じ条件を noteId ごとのインデックス探索で 0.1 ms で処理できており、ベースクエリもそちらの形なら数十 ms で済むはず

対策候補（効果順の見込み）:
1. ジョブのセッションで `SET enable_mergejoin = off`（+場合により enable_hashjoin = off）を試す — 深夜帯に EXPLAIN ANALYZE で 1 回実験してから。当たれば systems の 1 バッチ 10.4 秒 → 数十 ms 級で、**DB 時間の 80% がほぼ消える**
2. `ALTER TABLE note ALTER COLUMN id SET STATISTICS 1000` で ID ヒストグラムを細かくし、範囲見積もりを改善（無難だが効果は不確実）
3. アプリ側パッチ: ベース 10 件の選定と NOT EXISTS 判定を 2 段階のクエリに分離（upstream 貢献候補）

### 謎解き 2: 「掃除ジョブは CPU 律速」の再解釈

I/O 比率 13% の実態は「ディスクは読んでいない（共有バッファヒット 1,547 万回）が、無駄な行処理で CPU を焼いている」だった。チューニングというよりプラン修正の問題。

### 招かれざる客: 5432 番ポートが全世界に開いている（3 台とも・最優先）

PG ログに `testuser@postgres FATAL: no pg_hba.conf entry` の常連客が写り込んでいた。集計すると:

- 186.236.254.56 から 2 日間で約 740 回（user1 / testuser / test1 / postgresql / admin1 / postgre を巡回）
- 173.212.197.211、213.209.159.66 ほか複数 IP から postgres ユーザーの試行
- 手元から `nc -z` で確認したところ **3 台とも 5432 が外部から到達可能**

pg_hba が全部弾いており侵入はされていないが、総当たりの的になり続けている状態。listen_addresses='*' 自体は app サーバーからの接続に必要でも、**ファイアウォール（クラウド側 or ufw）で 5432 を app サーバーの IP だけに絞る**のが正道。パスワード総当たりが通る前に閉じるべき扉。
