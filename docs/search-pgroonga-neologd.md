# PGroonga + MeCab + NEologd 手動セットアップ手順

Misskey の検索バックエンド (`fulltextSearch.provider: sqlPgroonga`) を **MeCab + NEologd 辞書** + **NFKC ノーマライザ** で運用するときの手動セットアップ手順。

`.config/example.yml` の `sqlPgroonga` セクションが「最低限の SQL 例」を載せているのに対し、本ドキュメントは **本番ホスト上で何を順番に叩くか** を具体化したオペレーション手順書として読む。

## 前提

- PostgreSQL 12 以降 (`REINDEX INDEX CONCURRENTLY` を使うため)
- pgroonga extension がインストール済み
- mecab + mecab-ipadic がインストール済み (NEologd のベース辞書)
- `note` テーブルの規模は概ね 4500 万行を想定
- `.config/default.yml` で `fulltextSearch.provider: sqlPgroonga` を指定済み

## 手順サマリ

1. NEologd 辞書をビルド・配置
2. `/etc/mecabrc` を NEologd 辞書に向ける
3. PostgreSQL を再起動 (pgroonga が mecab を読み直すため)
4. 旧 pgroonga 索引を残したまま、ノーマライザ + NEologd 適用済みの新索引を `CONCURRENTLY` で作成
5. 動作確認後、旧索引を `DROP INDEX CONCURRENTLY`
6. 監視と運用

## 1. NEologd 辞書のビルド・配置

```bash
# 任意の作業ディレクトリで clone
git clone --depth 1 https://github.com/neologd/mecab-ipadic-neologd.git
cd mecab-ipadic-neologd

# 辞書ビルド (-y で対話省略、-p で配置先指定)
./bin/install-mecab-ipadic-neologd -n -y \
  -p /usr/lib/mecab/dic/mecab-ipadic-neologd
```

**注意:**

- NEologd 本体は **2020-09 で公式更新停止**。最終版を使う形になる。新語は別途カスタム辞書で補う想定 (本リポジトリの `検索Index最適化計画.md` 4.6 節参照)。
- 配置先パスはディストリビューションによって異なる。`/usr/lib/mecab/dic/` (Debian / Ubuntu 系) / `/usr/local/lib/mecab/dic/` (build from source) など環境差あり。
- 辞書サイズは約 800MB〜1GB。配置先のディスク容量を事前確認。
- 既に他サービスが `/etc/mecabrc` を使っている場合は、専用 mecabrc を用意して PostgreSQL の環境変数 (`MECABRC=/path/to/mistems-mecabrc`) で参照させると競合を避けられる。

## 2. mecabrc を NEologd に向ける

```bash
sudo vi /etc/mecabrc
```

以下のように `dicdir` を変更:

```
dicdir = /usr/lib/mecab/dic/mecab-ipadic-neologd
```

動作確認:

```bash
echo "進撃の巨人を見ました" | mecab
```

ipadic デフォルトなら `進撃 / の / 巨人 / を / 見 / まし / た`、NEologd なら `進撃の巨人 / を / 見 / まし / た` のように **「進撃の巨人」が 1 トークン化** されていれば OK。

## 3. PostgreSQL の再起動

pgroonga は内部で mecab プロセスを起動するため、mecabrc を切り替えただけでは既存接続には反映されない。**サービスを再起動する**。

```bash
sudo systemctl restart postgresql
```

検索 API は再起動中ダウンするので、メンテナンスウィンドウを確保すること。Misskey 本体への影響範囲は短時間で済むが、書き込みは詰まるのでクライアントエラーが出る可能性を念頭に。

## 4. 新索引を `CREATE INDEX CONCURRENTLY` で作成

旧索引 (`tokenizer='TokenMecab'` のみで作成済みの想定) は **DROP せずそのまま残す**。新索引が valid になるまでは検索を新旧どちらでもさばける状態を保つ。

```sql
-- 新索引 (NEologd 辞書 + NFKC ノーマライザ)
CREATE INDEX CONCURRENTLY pgroonga_note_text_index_v2
  ON note USING pgroonga (text)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC130("unify_kana", false), NormalizerRemoveBlank'
  );

CREATE INDEX CONCURRENTLY pgroonga_note_text_cw_index_v2
  ON note USING pgroonga ((coalesce(cw, '') || coalesce(text, '')))
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC130("unify_kana", false), NormalizerRemoveBlank'
  );
```

### 構築コスト目安 (4500 万件)

| 項目 | 目安 |
| --- | --- |
| 1 索引あたり構築時間 | 5〜10 時間 (SSD・余裕あるメモリ前提) |
| 2 本シリアル構築 | 10〜20 時間 |
| 索引サイズ (1 本) | 6〜12 GB |
| 構築中 INSERT への影響 | +20〜50ms 程度のレイテンシ上乗せ |

### 構築中の監視

```sql
-- 進捗を確認
SELECT phase, blocks_done, blocks_total
FROM pg_stat_progress_create_index;

-- index が valid になったかを確認
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'note' AND indexname LIKE 'pgroonga_%';

SELECT c.relname, i.indisvalid
FROM pg_index i
JOIN pg_class c ON i.indexrelid = c.oid
WHERE c.relname LIKE 'pgroonga_%';
```

### 構築失敗時の後始末

`CREATE INDEX CONCURRENTLY` が途中で失敗すると INVALID 索引が残る:

```sql
SELECT c.relname FROM pg_index i
JOIN pg_class c ON i.indexrelid = c.oid
WHERE c.relname LIKE 'pgroonga_%' AND i.indisvalid = false;

DROP INDEX CONCURRENTLY pgroonga_note_text_index_v2;
```

## 5. 動作確認 → 旧索引の DROP

新索引が valid になったら **必ず実データで動作確認** してから旧索引を落とす。

### 動作確認クエリ例

```sql
-- 全角/半角の同一視 (新ノーマライザの効果)
SELECT id FROM note
WHERE text &@~ 'Ａ ＢＣ'
LIMIT 5;
-- 半角 'A BC' でヒットした投稿が出れば NFKC が効いている

-- NEologd の固有名詞認識
SELECT id FROM note
WHERE text &@~ '進撃の巨人'
LIMIT 5;
-- ipadic 時代は AND 検索になっていた語が、1 語マッチで返ってくれば OK

-- ひらがな ↔ カタカナの分離 (unify_kana=false の効果)
SELECT id FROM note
WHERE text &@~ 'コーヒー'
LIMIT 5;
-- ひらがな "こーひー" がヒットしないことを別途確認 (unify_kana=true だとヒットしてしまう)
```

`pg_stat_user_indexes.idx_scan` が **新索引で増えていること** を確認:

```sql
SELECT indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE indexrelname LIKE 'pgroonga_%';
```

### 旧索引の DROP

```sql
DROP INDEX CONCURRENTLY pgroonga_note_text_index;     -- 旧索引
DROP INDEX CONCURRENTLY pgroonga_note_text_cw_index;  -- 旧索引

-- 新索引をリネームして将来の運用名に揃える (任意)
ALTER INDEX pgroonga_note_text_index_v2    RENAME TO pgroonga_note_text_index;
ALTER INDEX pgroonga_note_text_cw_index_v2 RENAME TO pgroonga_note_text_cw_index;
```

## 6. 監視と運用

### 定期監視項目

- `pg_stat_user_indexes.idx_scan` (索引が実際に使われているか)
- `pg_relation_size('pgroonga_note_text_index')` 等 (索引サイズの推移)
- 検索 API の p50 / p95 レイテンシ
- INSERT レイテンシ (`pg_stat_statements` の `notes_insert`)
- mecab プロセスの常駐数 / メモリ (`ps`, `top`)

### 辞書を更新したら REINDEX が必須

NEologd 辞書を差し替える / カスタム辞書を追加すると、既存索引は古い分かち書きで作られた posting list を持っており、新辞書を反映するには **REINDEX が必須**。

```sql
REINDEX INDEX CONCURRENTLY pgroonga_note_text_index;
REINDEX INDEX CONCURRENTLY pgroonga_note_text_cw_index;
```

- 4500 万件で REINDEX 1 本あたり 5〜10 時間が目安
- 検索は止まらない (CONCURRENTLY)、ただし書き込みレイテンシは上がる
- **月次〜四半期に集約するリリースサイクル** を運用書で固定するのが現実解

### pgroonga / mecab のバージョン更新時

- pgroonga のメジャー / マイナーバージョンを上げたら念のため REINDEX 推奨
- mecab 辞書のバージョン更新も同様

## 7. ロールバック

- Phase 2 / Phase 3 の同時投入直後に問題が出た場合、旧索引が残っていれば **新索引を DROP するだけで元に戻せる**。
- → 「新索引 CONCURRENTLY 作成 → 動作確認 → 旧索引 DROP」の順を守ることがロールバック可能性の保険になる。
- mecabrc を元に戻し、PostgreSQL を再起動すれば mecab の分かち書きも元に戻る (ただし新索引が NEologd 想定で作られている場合は再 REINDEX が必要)。

## 8. 関連ドキュメント

- [検索Index最適化計画.md](../検索Index最適化計画.md) — 索引戦略の詳細、ノーマライザ選定根拠、4500 万件規模のコスト見積もり
- [検索強化実装計画.md](../検索強化実装計画.md) — フェーズ別の実装計画 (Phase 2 / Phase 3 の本書ドキュメント、Phase 4 のカスタム辞書運用)
- pgroonga 公式: <https://pgroonga.github.io/tutorial/>
- NEologd 公式: <https://github.com/neologd/mecab-ipadic-neologd>
