# PGroonga 検索 Index ブラッシュアップ計画

[検索Index最適化計画.md](検索Index最適化計画.md) のうち、**今すぐ着手する範囲だけ** を切り出した実行計画。

## 0. スコープ

**やる (本書の範囲)**:

1. `SearchService` の実装変更 — textWithCw 検索の OR 化 + セッション設定の追加
2. pgroonga インデックスの張り直し / 追加 — **トークナイザは `TokenMecab` のまま変えない**。辞書もシステム標準 (ipadic) のまま
3. 投入後の「本当に索引が使われているか」検証

**やらない (親計画に残す)**:

- MeCab 辞書の差し替え (NEologd / カスタム固有名詞 CSV) — 親計画 4.5 / 4.6 節
- ハイライト・スニペット等の発展案 — 親計画 6 節
- `(text, id)` 複合化の実証 (D 案) — 親計画 TODO。本書のインデックスが安定してから
- スコア順ソート・同義語展開 — 親計画 5 節 (不採用)

前提は親計画と同じ: note 約 4500 万行、aid 採番 (id 辞書順 = 時系列順)、`fulltextSearch.provider: sqlPgroonga`。

## 1. 現状の問題 (2026-07 実測)

実環境に `pgroonga_note_text_index` (text) と `pgroonga_note_cw_index` (cw) を投入済みだが、`EXPLAIN (ANALYZE, BUFFERS)` で 2 つの問題が確認された (詳細: 親計画 9.1 節):

1. **textWithCw 検索で索引が使われていない**。クエリが `(coalesce(cw,'') || coalesce(text,'')) &@~ :q` という連結式のため、列単独索引と式が一致せず、`BitmapAnd(userHost × id レンジ)` フォールバック + Filter 逐次評価に落ちている。実測 **6238ms / ヒット 8 件 / shared read 600MB / JIT 694ms**。
2. **text と cw で normalizers が不一致**。text 側は `unify_middle_dot` + `unify_katakana_bu_sound` あり、cw 側はなし。OR 化すると CW と本文で正規化挙動がズレる。

## 2. 実装変更 (SearchService)

対象: `packages/backend/src/core/SearchService.ts` の `searchNoteByLike` (pgroonga 経路)。

### 2.1. textWithCw の OR 化 (必須)

```ts
// 変更前
query.andWhere('(coalesce(note.cw, \'\') || coalesce(note.text, \'\')) &@~ :q', { q });
// 変更後 (NULL &@~ :q は false になるだけなので coalesce 不要)
query.andWhere('(note.cw &@~ :q OR note.text &@~ :q)', { q });
```

- 列単独索引 2 本の BitmapOr が効くようになる。これが本計画の本丸
- 通常検索経路 (`note.text &@~ :q`) は**変更なし** — すでに text 索引と式が一致している
- 副次効果: 連結境界の偽マッチ (CW 末尾 + 本文先頭がフレーズ一致する) が構造的に消える
- 仕様上の挙動変化: 「CW と本文をまたぐフレーズ」はヒットしなくなる (正しい挙動になる)

### 2.2. セッション設定の追加 (推奨)

既存の `SET LOCAL statement_timeout = '15s'` の隣に追加:

```ts
await em.query('SET LOCAL jit = off');
```

- 実測で LIMIT 10 のクエリに JIT コンパイルだけで 694ms 溶けていた
- 索引が効けばコスト見積もりが下がり JIT は発動しなくなる見込みだが、**索引フォールバック時 (事故モード) の保険** として入れる価値がある
- 効果は投入後の EXPLAIN で確認し、不要と判明したら外してよい

### 2.3. 出荷チェック

- `pnpm lint` / `pnpm --filter backend test`
- API の `meta` / `paramDef` / `res` は触らないので misskey-js 再生成は不要 (触った場合は `pnpm build-misskey-js-with-types`)
- ユーザー可視の変更 (textWithCw 検索の高速化・偽マッチ解消) として `CHANGELOG.md` の `### Server` に 1 行追記

## 3. インデックス計画 (TokenMecab のまま)

### 3.1. 目標状態

| # | 索引 | 対象 | 状態 |
| --- | --- | --- | --- |
| A | `pgroonga_note_text_idx` | `text` 全件 | 実環境の `pgroonga_note_text_index` は tokenizer 設定が目標と異なる — **張り直す** |
| B | `pgroonga_note_cw_idx` | `cw` 全件 | 実環境の `pgroonga_note_cw_index` は normalizers 不一致 — **張り直す** |
| C | `pgroonga_note_local_text_idx` | `text` / `userHost IS NULL` | 任意 (後続判断 — 3.3 節)。**必須ではない** |
| C' | `pgroonga_note_local_cw_idx` | `cw` / `userHost IS NULL` | 任意 (C とセット) |

**normalizers は全索引で完全同一にする** (親計画 4.4 節 — 実環境で不一致事故が起きた):

```
NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)
```

> `unify_katakana_bu_sound` は「ヴァ/ヴィ/ヴ/ヴェ/ヴォ→すべてブ」なので「ヴァイオリン⇔バイオリン」は拾えない。母音を保つ `unify_katakana_v_sounds` への切り替え候補があるが、**本書では現行設定のまま揃えることを優先** し、切り替えは次回 REINDEX 時の検討事項とする (親計画 4.1 節)。ここで変えたくなったら A の張り直しも必要になり、スコープが膨らむため。

### 3.2. A / B の張り直し手順

`CONCURRENTLY` で新規作成 → 旧を DROP の順で無停止入れ替え。A (text, 4500 万行) は**数時間オーダー**、B (cw, ほぼ NULL) は**分オーダー**。入れ替え中は新旧が併存するため、A のサイズ 1 本分 (6〜12 GB) のディスク余裕を確保しておく。

```sql
-- 1. 新しい索引を目標設定で作成 (A → B の順にシリアルで)
CREATE INDEX CONCURRENTLY pgroonga_note_text_idx
  ON note USING pgroonga (text)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  );

CREATE INDEX CONCURRENTLY pgroonga_note_cw_idx
  ON note USING pgroonga (cw)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  );

-- 2. 完了と有効性を確認 (indisvalid = true であること)
SELECT c.relname, i.indisvalid
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname LIKE 'pgroonga_note%';

-- 3. 旧索引を落とす
DROP INDEX CONCURRENTLY pgroonga_note_text_index;
DROP INDEX CONCURRENTLY pgroonga_note_cw_index;
```

### 3.3. C / C' (ローカル限定部分索引) — 後続判断。必須ではない

**必須ではない理由**: OR 化後の想定プランは `BitmapOr(pgroonga_text, pgroonga_cw)` で検索語ヒットを絞り、ローカル限定は既存の `userHost` B-tree との BitmapAnd (またはヒープ Filter) で適用できる。検索語がそこそこ選択的なら全件索引 A + B だけで十分速い。

**それでも候補に残す理由**: 実測でこのインスタンスは **ローカル ≒35 万件 / 全体 ≒4554 万件 = 約 0.8%** という極端なリモート過多。この分布だと:

- 全件索引 A / B の中身の 99% は、デフォルト検索 (ローカル限定) が決して触らないリモートノート。**頻出語**の検索では pgroonga ビットマップの大半がリモートで、ヒープを読んでから捨てる無駄が出る。プランナが `userHost` B-tree と BitmapAnd すれば無駄は消えるが、その 35 万行ビットマップ構築に毎回数十〜200ms 払う
- 一方 C / C' は対象 0.8% なので **サイズ ~100MB 級・構築は分オーダー・INSERT の 99% (リモート流入) は索引更新をスキップ** — 追加コストほぼゼロで、デフォルト検索の最悪ケース (頻出語) だけを確実に潰せる

つまり C / C' は「保険的な最適化」。**A + B + OR 化の効果測定 (5.1 節) で、頻出語 × ローカル限定のプランにヒープ読み捨てや BitmapAnd コストが目立つ場合のみ**追加する。

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS pgroonga_note_local_text_idx
  ON note USING pgroonga (text)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  )
  WHERE "userHost" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS pgroonga_note_local_cw_idx
  ON note USING pgroonga (cw)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  )
  WHERE "userHost" IS NULL;
```

- 構文注意: `WHERE` は `WITH` の**後**。逆順は構文エラー
- ローカル比率は実測済 (≒0.8%) なので、C の構築も**分オーダー**で済む (対象 35 万行のみ)

### 3.4. コストまとめ

- 支配的なのは A の再構築 (数時間オーダー、`CONCURRENTLY` なので無停止)。B は分オーダー
- 入れ替え中の一時的なディスク余裕: A 新旧併存分 (+6〜12 GB)
- C / C' を採る場合もローカル 0.8% のため構築・サイズとも軽微 (分オーダー / ~100MB 級)
- INSERT への影響: 現状 (text + cw の 2 本) から本数は変わらず実質増えない。C / C' を足してもリモート流入 (INSERT の 99%) は部分索引の更新をスキップするため誤差

## 4. ロールアウト手順

順序が重要。**索引を先に揃えてからコードを出す** (逆にすると OR クエリが不揃い設定の索引で動く期間ができる):

1. **A / B 張り直し** (3.2 節) — A は数時間、B は分オーダー。いずれも無停止
2. `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'note' AND indexdef ILIKE '%pgroonga%';` で全索引の tokenizer / normalizers が同一であることを突き合わせ
3. **SearchService 変更をデプロイ** (2.1 / 2.2 節)
4. **EXPLAIN 検証** (5 節) — textWithCw 検索で pgroonga 索引の BitmapOr が出ることを確認
5. 効果測定の結果を見て C / C' (3.3 節) の採否を判断 — 頻出語 × ローカル限定でヒープ読み捨て / BitmapAnd コストが目立つ場合のみ採用
6. `.config/example.yml` / `docker_example.yml` の `sqlPgroonga` セクションの案内 SQL を本書 3.2 / 3.3 の DDL に更新 (親計画 3 節の DDL と両方を同時更新すること — normalizers の不一致事故防止)

## 5. 検証

### 5.1. 投入直後 (必須)

- 代表クエリの `EXPLAIN (ANALYZE, BUFFERS)`:
  - 短い日本語 (2 字) + ローカル限定 + textWithCw ← 今回事故ったパターン
  - 通常検索 (text のみ) — リグレッションがないこと
  - host 指定 / userId 指定
- 期待するプラン: `BitmapOr(pgroonga_note_cw_idx, pgroonga_note_text_idx(相当))` → Bitmap Heap Scan。`BitmapAnd(userHost × PK id レンジ)` が出たら**索引が使われていない** (事故モード)
- ベースライン比較: 旧 6238ms / shared read 76186 → 数十 ms / 数百ブロック程度まで落ちる見込み

### 5.2. 継続監視

- `pg_stat_user_indexes.idx_scan` — 「張ったのに使われない索引」の検出 (今回の事故はエラーにならず静かに起きた)
- 検索 API の p50 / p95 レイテンシ
- `pg_stat_statements` で検索クエリの mean_exec_time 推移
- `pg_index.indisvalid = false` の索引 (CONCURRENTLY 失敗残骸) の定期チェック

## 6. リスク / 注意

- **クエリ式と索引の対応はズレると静かに壊れる**。SearchService 側で `&@~` まわりの式 (OR の形、coalesce、キャスト) を変えるときは EXPLAIN 確認をセットにすること
- `DROP INDEX CONCURRENTLY` は該当索引を使う実行中クエリの完了を待つ。検索負荷の低い時間帯に実施
- 部分索引 C / C' の `WHERE "userHost" IS NULL` は SearchService の host 条件の書き方と完全一致が必要
- normalizers を将来変える場合 (`unify_katakana_v_sounds` 化など) は **A / B / C / C' 全部を同時に張り直す**。片方だけの変更は 4.4 事故の再演

## 7. TODO

- [ ] A (text) / B (cw) 索引の張り直し (3.2 節 — A は数時間、要ディスク余裕 +6〜12GB)
- [ ] 全 pgroonga 索引の定義突き合わせ (4 節 step 2)
- [ ] SearchService: textWithCw の OR 化 (2.1 節)
- [ ] SearchService: `SET LOCAL jit = off` 追加 (2.2 節)
- [ ] `pnpm lint` / backend test / CHANGELOG 追記 (2.3 節)
- [ ] EXPLAIN 検証 — BitmapOr が出ること + レイテンシ実測 (5.1 節)
- [ ] C / C' 採否判断 (3.3 節 — 頻出語 × ローカル限定の実測プランを見てから。必須ではない)
- [ ] example.yml / docker_example.yml の案内 SQL 更新 (4 節 step 6)
