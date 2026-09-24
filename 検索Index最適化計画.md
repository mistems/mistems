# 検索 Index 最適化計画

`packages/backend/src/server/api/endpoints/notes/search.ts` (= `SearchService.searchNote`) 専用に張る索引の方針案。タイムライン等で再利用される既存索引には触らない。

## 0. スコープ / 前提

- 本ドキュメントは **pgroonga プロバイダ (`fulltextSearch.provider: sqlPgroonga`) を有効化したインスタンス向け**。
  - `sqlLike` (Postgres 標準) は note テーブルが少しでも大きくなるとタイムアウトレベルで実用にならない。本気で検索したい運用者は pgroonga か Meilisearch を選ぶ前提とする。
  - PGroonga セットアップとインデックス導入が前提のラインまで来た運用者には、もはや sqlLike 用ガイダンスは不要と判断し、本書では扱わない。
- 既存方針 (pgroonga 索引は migration ではなく `.config/example.yml` で案内) を踏襲し、**migration では作らずに example.yml / docs で SQL を案内する**。
- 索引追加は `CREATE INDEX CONCURRENTLY` を使い、production DB のロックを避ける。
- **本書の前提インスタンス規模**: note テーブル約 **45,542,304 行 (≒ 4500 万)**。MISTEMS フォーク運用想定。ストレージ消費と INSERT 影響の見積もりはこの規模を基準にする。
- **ID 採番方式**: Misskey デフォルトの **aid** (`[8 桁 base36 (2000/1/1 起点 ms)] + [2 桁ノイズ]`) を採用している前提。
  - 構造上、**文字列辞書順 = 時系列順** が成立する。
  - したがって本書では「id 順ソート」と「時系列ソート」を同義に扱う。
  - aidx / meid / meidg / ulid も時刻先頭の単調増加なので同様に成立する。**objectid** だけは順序保証が弱いので本書の前提から外す。
- **2026-07 実測反映済み**: 実環境 (note 約 4500 万行) に text / cw の列単独索引を投入して `EXPLAIN (ANALYZE, BUFFERS)` を取得した知見 (9.1 節) を反映。最大の教訓は「**列単独の pgroonga 索引は連結式クエリには使われない**」こと。これに伴い当初の「cw+text 連結式索引」案は廃し、**OR 検索 + 列単独索引 2 本** 方式へ転換した (2.3 節)。

## 1. 現状の検索クエリ整理

`SearchService.searchNoteByLike` (pgroonga 経路含む) が WHERE で参照する列とその条件:

| 列 / 式 | 条件 | 由来 | 出現頻度 |
| --- | --- | --- | --- |
| `note.text` | `&@~ :q` | 通常検索 (`searchFrom !== 'textWithCw'`) | 必 |
| `note.cw` / `note.text` | `(cw &@~ :q OR text &@~ :q)` | textWithCw オプション (連結式 `coalesce(cw,'') \|\| coalesce(text,'')` から OR 形式へ変更 — 2.3 節) | 必 (片方) |
| `note.id` | `BETWEEN` + `ORDER BY DESC LIMIT n` | レンジ + ページネーション | 必 |
| `note.userHost` | `=` / `IS NULL` | host 指定 / ローカル限定 | 高 (デフォルトがローカル限定) |
| `note.userId` | `=` | userId 指定 | 中 |
| `note.channelId` | `=` | channelId 指定 | 低 |
| `note.fileIds` | `<> '{}'` / `= '{}'` | withFiles オプション | 低〜中 |

並び順は **常に時系列 (id DESC)**。スコア順ソートは現状提供しない (5 節「採用しない発展案」参照)。

Note エンティティに既存の索引のうち検索で関連するもの:

- `("userId", "id")` 複合 — userId 検索 + 時系列に効く
- `("userHost")` 単独
- `("channelId")` 単独
- `IDX_NOTE_FILE_IDS` GIN — 配列含有判定用。`= '{}'` / `<> '{}'` には効かない。

## 2. pgroonga 索引戦略 — 単独 vs 複合 vs 部分

### 2.1. 各方式の比較

| 方式 | サイズ | INSERT コスト | 検索性能 | 柔軟性 |
| --- | --- | --- | --- | --- |
| 列単独索引 × 2 (`text` / `cw`) + OR 検索 | 中 (cw 側は極小) | 中 | 検索ワード次第。2 本の BitmapOr。userHost 等の絞り込みは別索引と bitmap AND | 高 |
| 連結式索引 (`coalesce(cw,'') \|\| coalesce(text,'')`) | 中 | 中 | 1 本で textWithCw を賄えるが、**クエリ式と 1 文字でも違うと使われない** (9.1 節で実証) | 低 |
| 複合 pgroonga 索引 (`text` + `userHost` 等) | 大 | 大 | 1 回の索引アクセスで複数条件を絞れる | カラム追加で索引爆発 |
| 部分索引 (ローカル/添付あり等の WHERE 条件付き) | 小 | 小 | 該当条件に完全特化 | 条件外検索はカバーできない |

### 2.2. 4500 万件規模での選択

note 4500 万件、平均 text 長を仮に 80〜120 文字とすると:

- pgroonga 索引 1 本のサイズ目安 = **約 6〜12 GB** (TokenMecab + posting list + メタデータ)
  - `cw+text` 式索引は cw が大半 NULL なので text 単独とほぼ同サイズ
- 複合索引 (`text, userHost`) はさらに +1〜2 GB 程度
- **CREATE INDEX CONCURRENTLY** の構築時間目安 = **数時間〜十数時間** (ハードウェア依存、SSD で 100k rows/sec 程度を仮定すると約 7 時間)
- 構築中: 既存検索は止めない、ただし `INSERT` / `UPDATE` が若干スロー化する
- 構築後の INSERT 影響: 1 ノート挿入で **テキストのトークン化 + posting list 更新** が発生。秒間 100 投稿程度までは余裕、秒間 1000 投稿級なら pgroonga 専用のチューニング (`work_mem` 等) と監視が必要

### 2.3. 採用方針

**「列単独索引 2 本 (text / cw) + OR 検索」をベースに、デフォルトケースである "ローカル限定検索" を部分索引で別に持つ** を推奨する。

当初は textWithCw 用に `coalesce(cw,'') || coalesce(text,'')` の連結式索引を張る計画だったが、**実測 (9.1 節) を踏まえて OR 形式へ転換した**:

- PostgreSQL が式索引を使うのは **クエリ側の式が索引定義の式と完全一致するときだけ**。実環境で text / cw の列単独索引を張った状態で連結式クエリを投げたところ索引は一切使われず、`&@~` が Filter に落ちて 6 秒超 (ヒットわずか 8 件) という事故が実際に起きた (9.1 節)。
- クエリ側を `(note.cw &@~ :q OR note.text &@~ :q)` に書き換えれば、列単独索引 2 本の BitmapOr で解決する。`NULL &@~ :q` は false になるだけなので coalesce も不要。
- cw は大半のノートで NULL なので cw 索引は極小。text 索引は通常検索と textWithCw で**共有**でき、連結式方式 (通常用 text + textWithCw 用連結の 2 本を別々に維持) より索引の総本数・総サイズ・INSERT コストすべてで軽い。
- 連結方式特有の「CW 末尾 + 本文先頭が繋がってフレーズ一致する」偽マッチも構造的に消える。
- 式索引は「DDL 側の式とコード側の式が 1 文字でもズレる (キャストの書き方含む) と索引が**黙って**使われなくなる」恒久的な地雷を抱える。気づきにくいのが最も厄介 (今回も EXPLAIN を取るまで発覚しなかった)。列単独索引ならこのリスク自体が存在しない。

複合索引を採らない理由・部分索引を持つ理由は従来どおり:
- 複合 `(text, userHost)` は searchFrom 経路ごとに増殖し、INSERT への影響が読みづらい。
- Misskey の検索 UI は **ローカル限定がデフォルト** で、利用の大半を占める。ここを部分索引で軽くしておけば検索体験の伸びとストレージ消費のバランスが取れる。
- 残りのフィルタ (userId / channelId / fileIds) は既存索引 + pgroonga の bitmap AND で十分高速化できると見込む (要計測)。

## 3. 採用する pgroonga 索引

> **DDL の正は本節と [PGroonga検索Indexブラッシュアップ計画.md](PGroonga検索Indexブラッシュアップ計画.md) 3.2 / 3.3 節の 2 箇所に存在する**。normalizers / tokenizer を変更するときは必ず両ファイルを同時に更新すること (4.4 節の不一致事故の温床になる)。

**前提となるコード変更**: `SearchService.searchNoteByLike` の textWithCw 経路を連結式から OR 形式へ変更する。これをやらない限り下記 A / B は textWithCw 検索に使われない (9.1 節で実証済)。

```ts
// 変更前
query.andWhere('(coalesce(note.cw, \'\') || coalesce(note.text, \'\')) &@~ :q', { q });
// 変更後 (NULL &@~ :q は false になるだけなので coalesce 不要)
query.andWhere('(note.cw &@~ :q OR note.text &@~ :q)', { q });
```

### A. `text` 単体 (通常検索 + textWithCw の text 側 / 全件)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS pgroonga_note_text_idx
  ON note USING pgroonga (text)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  );
```

### B. `cw` 単体 (textWithCw の cw 側 / 全件)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS pgroonga_note_cw_idx
  ON note USING pgroonga (cw)
  WITH (
    tokenizer  = 'TokenMecab',
    normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_hyphen_and_prolonged_sound_mark", true, "unify_middle_dot", true, "unify_katakana_bu_sound", true)'
  );
```

cw は大半のノートで NULL のため、索引サイズ・構築時間・INSERT コストとも text 索引と比べて誤差レベル。**normalizers は必ず A と同一にする** (4.4 節 — 実環境で不一致が起きた)。

> **不採用 (旧 B 案): `coalesce(cw,'') || coalesce(text,'')` 連結式索引** — 式完全一致縛りにより、コード側の式と 1 文字でもズレると索引が黙って使われなくなる (9.1 節で実際に発生)。通常検索用の text 索引と別に維持する分ストレージ・INSERT コストも純増し、CW/本文の連結境界をまたぐ偽マッチも生む。OR 形式で機能的に等価以上が実現できるため採用しない。

### C. ローカル限定の部分索引 (デフォルト検索の軽量化)

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

> 構文注意: `WHERE` 句は `WITH` 句の **後** に書く (`CREATE INDEX ... WITH (...) WHERE ...`)。逆順は構文エラー。

> 部分索引はローカルノートが note 全体の何 % かに応じて効果が変わる。ローカル少数 / リモート多数のインスタンスでは特に効く (大半を占めるリモートの分を索引対象から外せる)。

### D. (採用候補) `note.id` フィルタ列の同梱

`WHERE text &@~ :q AND note.id < :untilId` の `id` 条件を pgroonga 索引段階で適用できると、後段の `ORDER BY id DESC LIMIT n` が軽くなる:

```sql
CREATE INDEX ... ON note USING pgroonga (text, id) WITH (...);
```

aid 採番前提なので **id の辞書順 = 時系列順**。pgroonga 索引の 2 カラム目として id を持たせれば、`untilId / sinceId` の範囲フィルタが索引段階で効くことが期待できる (= 検索→ソート→ページ切り出しの取得行数が大幅に減る)。

ただし pgroonga 索引内で 2 カラム目の **string 比較条件** がどの程度効率的に評価されるかはバージョン依存があるので、A 単独索引と並行ベンチ (9 節) で実証する。効果が確認できれば A / B / C / C' すべてを `(text, id)` / `(cw, id)` 形式に張り直す。

## 4. ノーマライザ深掘り (本計画の山場)

ノーマライザはユーザー体感のヒット率に直接効く。MISTEMS フォークは日本語主体なので**厚く入れる**方針。

### 4.1. 入れたいもの

- **`NormalizerNFKC150`** — Unicode 15.0 ベースの NFKC 正規化 (当初 NFKC130 を予定していたが、Groonga 16.0.5 で NFKC150 が利用可能なため採用)
  - 全角/半角英数字の同一視 (`Ａ` ⇔ `A`、`１` ⇔ `1`)
  - 互換等価 (`㌧` ⇔ `トン`、`㎏` ⇔ `kg`)
  - ASCII 大文字小文字の同一視 (CI 動作)
  - 結合文字の正規化 (濁点合成等)
  - 「黒文字」(英数字・記号) 系の正規化はここで吸収される
  - **`"unify_kana", true`** — ひらがな⇔カタカナの同一視。SNS 投稿はカナ表記揺れが多く、ヒット率を優先して有効化する
  - **`"unify_hyphen_and_prolonged_sound_mark", true`** — ハイフン・長音記号っぽい文字をハイフンへ統一 (`ー` `—` `‐` `─` 等)。「コーヒー」「コーヒ─」等の表記揺れを吸収する
  - **`"unify_middle_dot", true`** — 中黒類 (`・` `･` `•` 等) の統一。「ぼっち・ざ・ろっく」等、中黒の字種揺れを吸収する (実環境で採用済)
  - **`"unify_katakana_bu_sound", true`** — 「ヴァ/ヴィ/ヴ/ヴェ/ヴォ」を**すべて「ブ」へ**統一 (実環境で採用済)。「ラヴ」⇔「ラブ」は拾えるが、「ヴァイオリン」⇔「バイオリン」は拾えない (ヴァ→ブ となり「バ」と一致しないため)。母音を保って「バ/ビ/ブ/ベ/ボ」へ寄せる **`unify_katakana_v_sounds`** の方が意図 (ヴ音の表記揺れ吸収) に合う可能性が高く、次回 REINDEX 時に切り替えを検討する (要検証)

### 4.2. 入れないもの

- **`NormalizerRemoveBlank`** — 当初「空白除去」として入れたかったが、**Groonga 16.0.5 に存在しないことが判明** (`plugin_register normalizers/remove_blank` → `.so` 不在エラー)。TokenMecab がトークン化時に空白を処理するため、実用上の問題はない
- **濁音記号合成系** (`unify_sound_mark` / `KanaWithVoicedSoundMark`) — 「はな」「ばな」「ぱな」を同一視するのはノイズが多すぎるため見送り
- **`NormalizerMySQLUnicode520CIExceptKanaCIKanaWithVoicedSoundMark`** — PGroonga 固有のノーマライザで設定が複雑。NFKC150 のオプションで十分カバーできる

### 4.3. あいまい検索系の扱い

- 例: 「ノーマライザで類似漢字を同一視する」「読みあいまい」系
- 単語一致が崩れるリスクと、ヒット率の伸びがトレードオフになる
- 本計画では `unify_kana: true` + `unify_hyphen_and_prolonged_sound_mark: true` まで踏み込むが、`unify_sound_mark` (濁点無視) は採用しない。**カナ統一と長音統一は SNS 文脈で実用的なヒット率向上が見込める一方、濁点無視はノイズが多すぎる** という線引き
- example.yml では「推奨版 (上記)」「厳しめ版 (`unify_kana: false`)」の SQL 例を併記する

### 4.4. A・B・C 索引でノーマライザを揃える

ノーマライザ (と tokenizer) は必ず A (text)・B (cw)・C/C' (部分索引) で同一指定に揃える。揃わないと「本文でヒットするのに CW でヒットしない」「全件検索ではヒットするのにローカル限定検索でヒットしない」が起きる。

**実環境で実際に不一致が起きた**: text 側には `unify_middle_dot` + `unify_katakana_bu_sound` を指定したのに cw 側には指定し忘れており、OR 検索にした際 CW と本文で正規化挙動がズレる状態だった。手で 2 本の DDL を書くと高確率でズレる。対策:

- example.yml / docs には **A〜C' の DDL をコピペ可能な一式** として載せ、normalizers 文字列を個別に編集させない
- 投入後に `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'note' AND indexdef ILIKE '%pgroonga%';` で全索引の定義 (WITH 句の tokenizer / normalizers 含む) を突き合わせる確認手順をドキュメントに含める

### 4.5. MeCab 辞書: NEologd 採用検討

MeCab のデフォルト辞書 (ipadic) は新語・固有名詞・スラング・商品名に弱く、それらが **未知語扱いで細かく分割される**。Misskey 上でこれが効くケースが多い:

- 「進撃の巨人」が `進撃 / の / 巨人` に分割される → 別の文脈の「進撃」も巨人も拾うので精度は落ちる
- 「ポケモンGO」「ハッピーセット」のような商品名・固有名詞も同様
- ハッシュタグや派生スラング、SNS 由来の新語 (例: 「○○構文」「△△ニキ」) も無理

**NEologd (`mecab-ipadic-neologd`)** を導入すると上記が 1 トークン化され、検索精度が体感で上がる。

#### 適用方法

[CyberRex 氏 (@cyberrex@mi.cbrx.io) の知見](https://mi.cbrx.io/) として:

1. `/etc/mecabrc` の `dicdir = ...` を NEologd ディレクトリに差し替える
2. PGroonga 索引作成時の SQL は **無変更**:
   ```sql
   CREATE INDEX ... USING pgroonga (text)
     WITH (tokenizer = 'TokenMecab');
   ```
3. システム側 mecab が NEologd を読むので、PGroonga 側は `TokenMecab` のままで自動的に NEologd で分かち書きされる

PGroonga 側のコード変更が一切不要なので、**「索引を作り直す前に辞書だけ先に差し替えて評価する」**という段階的導入が可能。

#### NEologd の現状と代替

参考: <https://zenn.dev/azookey/articles/8110a904e30229>

- NEologd は **2020 年 9 月で公式更新停止**。それ以降の新語 (オミクロン株、ChatGPT、Vtuber 関連新語など) はカバーされない
- 代替候補 **SudachiDict** は活発に更新されているが UniDic 品詞体系で ipadic 非互換 → **PGroonga の `TokenMecab` からは直接読めない**
- 現実解:
  - NEologd の最終版 (2020-09) をベースに採用
  - 必要に応じてカスタム辞書 (`user_dic`) で MISTEMS 固有の語彙 (フォーク名・コミュニティ用語・絵文字読みなど) を追加する
  - PGroonga 公式が将来 Sudachi 対応すれば移行検討

#### コスト

- 辞書サイズ: システム辞書として **800MB 〜 1GB** (圧縮前)、配置先は PostgreSQL ホスト
- 索引サイズへの影響: 語彙が 1 トークン化される分、posting list が短くなりむしろ縮む傾向 (要実測)
- 索引構築時間への影響: 形態素解析処理が増えるので **+10〜30%** 程度の見積もり (要実測)
- メンテ: 辞書バージョン固定 + PostgreSQL ホストの構成管理に NEologd ディレクトリを含める

#### 効果見極めの指針

- 固有名詞・アニメ名・商品名が頻出するインスタンス → 大きい
- 日常会話・短文ノート主体 → 中程度
- 英語主体 → 効果薄

MISTEMS のような日本語コミュニティ運用なら効果が大きい側に寄ると想定。

### 4.6. 固有名詞カスタム辞書 (ゲームタイトル等) — MISTEMS 独自パッチ

NEologd は 2020-09 で更新停止。**それ以降のゲーム / アニメ / VTuber / SNS ミーム**を検索で 1 トークンとして拾うには、**MISTEMS 独自の固有名詞 CSV パッチ**を NEologd の上に積む運用が現実解。

ユーザー投稿で頻出するわりに ipadic + NEologd 最終版で誤分割される代表例:

- **ゲーム**: 原神 / 崩壊スターレイル / ティアキン / ヘブバン / ブルアカ / ストリート系インディー作品
- **アニメ**: 推しの子 / 葬送のフリーレン / ぼっち・ざ・ろっく / リコリス・リコイル
- **VTuber / 配信者**: にじさんじ / ホロライブ所属各タレント名と通称
- **SNS スラング / ミーム**: 「○○構文」「△△ニキ」「□□くん」系の派生ネタ
- **Misskey / フェディバース固有**: フォーク名、Misskey 特有機能名、コミュニティで定着した絵文字読み

#### CSV フォーマット (mecab-ipadic 互換)

```
表層形,左文脈ID,右文脈ID,コスト,品詞,品詞細分類1,品詞細分類2,品詞細分類3,活用型,活用形,原形,読み,発音
```

ゲームタイトルの例:

```csv
原神,1290,1290,1000,名詞,固有名詞,一般,*,*,*,原神,ゲンシン,ゲンシン
崩壊スターレイル,1290,1290,1000,名詞,固有名詞,一般,*,*,*,崩壊スターレイル,ホウカイスターレイル,ホーカイスターレイル
ティアキン,1290,1290,1000,名詞,固有名詞,一般,*,*,*,ティアキン,ティアキン,ティアキン
ブルーアーカイブ,1290,1290,1000,名詞,固有名詞,一般,*,*,*,ブルーアーカイブ,ブルーアーカイブ,ブルーアーカイブ
ブルアカ,1290,1290,1000,名詞,固有名詞,一般,*,*,*,ブルアカ,ブルアカ,ブルアカ
ヘブンバーンズレッド,1290,1290,1000,名詞,固有名詞,一般,*,*,*,ヘブンバーンズレッド,ヘブンバーンズレッド,ヘブンバーンズレッド
ヘブバン,1290,1290,1000,名詞,固有名詞,一般,*,*,*,ヘブバン,ヘブバン,ヘブバン
```

- **コスト 1000** = NEologd の固有名詞デフォルト相当。表層が長い語ほどコストを小さく (= 優先度高く) するのが本家流だが、初期は固定 1000 で十分動く。
- **左/右文脈 ID 1290** = ipadic の `名詞,固有名詞,一般` の慣例値。**環境差があるため初期構築時に `left-id.def` で確認すること**。
- **読み・発音はカタカナ** 必須。略称 (ティアキン・ブルアカ) と正式名称 (ゼルダの伝説 ティアーズオブザキングダム / ブルーアーカイブ) を **両方** 登録するのが実用上の鍵 — 一方しか登録しないと別の表記が誤分割される。
- 詳細: <https://github.com/neologd/mecab-ipadic-neologd/wiki/Add-a-new-noun-to-ipadic>

#### private リポジトリ運用 (推奨構成)

```
mistems-mecab-dic/                # private リポジトリ
├── seed/                          # ipadic + neologd seed (git submodule)
├── patches/
│   ├── games.csv                  # ゲーム本作タイトル
│   ├── games-abbrev.csv           # ゲームの略称・俗称
│   ├── anime.csv                  # アニメ・漫画
│   ├── vtuber.csv                 # VTuber 名 / グループ
│   ├── meme.csv                   # SNS ミーム
│   ├── mistems-internal.csv       # MISTEMS フォーク固有用語
│   └── community.csv              # コミュニティ提案語の溜まり場
├── scripts/
│   ├── normalize-csv.sh           # nkf で UTF-8 化、改行統一
│   ├── validate.py                # 重複・フォーマット検証
│   └── build.sh                   # seed + patches → out.csv → mecab-dict-index → sys.dic
├── .github/workflows/build.yml    # CI: PR 検証 + nightly build artifact
└── README.md
```

#### ジャンル別に CSV を分ける理由

- **責任分担**: 「ゲームは A さん、アニメは B さん」のように管理権限を分けやすい
- **追加判断の独立**: ゲーム界の語彙追加と SNS ミーム追加で品質基準が違うため、レビューポリシーをファイル単位で変えられる
- **ロールバック容易**: 「最近の SNS ミーム追加で誤分割が増えた」ときに `meme.csv` だけ revert できる
- **ライセンス出所明示**: Wikipedia 由来 / 公式サイト由来など出典がジャンルで偏るので、ファイル冒頭コメントに出典を書く

#### 追加プロセス (案)

1. PR で `patches/<ジャンル>.csv` に追記
2. CI: `validate.py` で 重複 / フォーマット / 読みのカタカナ 検証
3. マージで毎晩バッチビルド → `sys.dic` を CI アーティファクトとして出力 (Git では成果物を持たない)
4. メンテナンスウィンドウで PostgreSQL ホストへ配置 → `REINDEX INDEX CONCURRENTLY pgroonga_note_text_idx` (および textWithCw 版・部分索引版)

#### 初期パッチ収集の現実的な手段 (実態評価)

「クロールできるか / してよいか」はソースごとに差が大きい。**実際にやれるルート** と **やめておくべきルート** を分けて整理する。

##### ◎ 確実に可能・合法

- **Wikipedia ダンプ + カテゴリ抽出 (本命)**
  - dump サイト <https://dumps.wikimedia.org/jawiki/> から月次ダンプを取得
  - 「Category:○○年のコンピュータゲーム」「Category:日本のテレビアニメ作品 (2020 年代)」等から記事タイトル + 記事冒頭のフリガナを抽出
  - ライセンス **CC BY-SA 4.0** で再利用可能 (出典明記要)
  - 一発で数千〜数万件規模を合法的にカバーできる **唯一現実的な大量取得手段**
  - クローラ不要 → robots.txt や rate limit と無縁
- **Annict API** (アニメ): <https://developers.annict.com/>
  - 公式 GraphQL API、OAuth 認証要。タイトル + 読みが取れる
- **MediaWiki Action API** (Wikipedia 更新検知用): ダンプを補完して「最近作られた記事」を取る用途
  - `action=query&list=categorymembers` で最新カテゴリメンバーを取得
  - rate limit を守れば公式に許可されている
- **自インスタンスログから未知語抽出 (最も精度が高い)**
  - **外部依存ゼロ + 規約問題ゼロ**
  - 実装案: SearchService に到達したクエリログ + 投稿テキストを MeCab で再解析、「ipadic + NEologd で未知語 (品詞不明 / 細切れ) になった連続形態素」を集計
  - 出現頻度が高い未知語候補 → 月次レポート → 人手で patches/ に追加
  - 「**自インスタンスのユーザーが実際に投稿し、検索しようとしている語**」が直接取れるので投資対効果が最も高い

##### △ 規模が小さいので手動入力で十分

- **VTuber 事務所公式** (にじさんじ / ホロライブ等): 200〜300 名程度。クロールするより手動 PR の方が早い
  - Wikipedia の「○○所属タレントの一覧」記事から取る方が合法的かつ網羅性も高い
- **任天堂 / ソニー / MS の自社ストア**: 公式 API なし、スクレイピングは規約違反リスク
  - 代替: Wikipedia のゲームカテゴリでほぼカバーできる

##### × やらない方がよい (利用規約 NG / API 終了 / リスク高)

- **Steam ストアの大量スクレイピング**
  - SteamWorks Web API には `GetAppList` で全 app ID + 英名は取れるが、**日本語タイトル取得には storefront API を叩く必要があり rate limit が厳しく、規約上もグレー**
  - 日本語タイトルが欲しいなら Wikipedia 経由のほうが安全
- **Nintendo eShop / PlayStation Store の動的取得**
  - 公式 API なし。スクレイピング検知体制があり、IP ブロックリスクあり
- **X (Twitter) / Pixiv 等 SNS のクロール**
  - X は API 有料化で実質終了
  - Pixiv は規約で禁止
  - **「他 SNS の流行語から新語を取ってくる」案は現状ほぼ全滅**

##### 結論: 現実的な収集パイプライン

1. **大量取得は Wikipedia ダンプ 1 本に絞る** (CC BY-SA、月次、規模十分)
2. **継続更新は自インスタンスログの未知語抽出** で実需に追従させる
3. **隙間 (VTuber 名・MISTEMS 内輪用語) は手動 PR + コミュニティ提案**
4. **Steam / eShop / SNS クロールは「やらない」を明示** (誰かが思い付きで実装するのを防ぐためにここに書いておく)

新語検出は「外部から流行を取ってくる」よりも「自インスタンスで実際に投稿された未知語を拾う」方が、合法・確実・精度のすべてで優れる。MISTEMS の運用文脈ならなおさら。

#### サイズとメンテ負荷の見立て

- 初期 1 万語規模なら CSV 合計 1〜2MB、CI ビルド時間 +数分以内。NEologd 本体 (数十万語) と比べれば誤差。
- 月 1 回のリリースサイクルで 100〜500 語追加できれば十分価値がある運用。
- 追加が完全に止まると本家 NEologd と同じ運命 (= 古びる) を辿るので、**継続的に追加する仕組み**が重要。

## 5. 採用しない発展案 (将来検討)

### 5.1. スコア順ソート (`pgroonga_score()`)

- 採用しない。Misskey の検索は**時系列順**が基本で、スコア順に変えるのは UX 変更を伴う。
- Misskey の検索ワードは比較的シンプル (単語 1〜2 個) が多く、スコアの差がつきにくいことも採用見送りの理由。
- 採用条件: **UI に「時系列 / スコア順」の切替を入れる場合のみ**。その場合に限り `pgroonga_score()` を使う方向で索引設計を見直す (id を索引に同梱する案 = 2.D)。

### 5.2. 添付ファイル本文の全文検索 (ChupaText 連携)

- 採用しない。Misskey 運用上、添付ファイルにファイル名すらまともに付けないユーザーも多く、検索性能向上に見合わない。
- 副次的な抽出 (画像 OCR / PDF テキスト) もコスト過剰。

### 5.3. 入力補完 (オートコンプリート)

- 採用しない。本計画スコープ的に重すぎる。
- 必要なら別 issue で `terms` テーブル + `&^~` (前方一致) + 緩い全文検索の組み合わせで実装。

### 5.4. 同義語展開 (`pgroonga_query_expand()`)

- 採用しない。辞書を用意・メンテするコストが過大。
- 必要なら絵文字エイリアス等の限定領域で別途検討。

## 6. 採用する発展案 (本計画と同時 or 直後)

### 6.1. マッチ箇所ハイライト (`pgroonga_highlight_html()`)

- 検索結果に「マッチ箇所を `<span class="keyword">` で囲んだスニペット」を返せる。
- SearchService.searchNote の戻り値に「ハイライト済み HTML」を追加して、フロントエンドはそれをそのまま埋め込む。
- 効果: 検索結果の体感品質が一段上がる。

### 6.2. キーワード配列の抽出 (`pgroonga_query_extract_keywords()`)

- ユーザーのクエリ (`+検索 -ノート` 等) から AND/OR/NOT を解いて、マッチしたキーワード配列を取り出せる。
- フロントエンドのハイライト処理を SQL 側に寄せられる (正規表現で頑張る必要が消える)。

### 6.3. 周辺テキストの抜粋 (`pgroonga_snippet_html()`)

- マッチ箇所前後の数十文字を切り出して返せる。
- 長いノートの検索結果一覧で「全文表示」せず「マッチ箇所のみ抜粋」UI を実現可能。

これらは別 PR / 別 issue で扱うが、**索引設計に影響しない** ので本計画の索引と並行して進められる。

## 7. ストレージ / INSERT パフォーマンス見積もり (4500 万件)

### 7.1. ストレージ

| 索引 | 推定サイズ |
| --- | --- |
| A. `text` 全件 | 6〜12 GB |
| B. `cw` 全件 | 数十〜数百 MB (cw 非 NULL 率依存。text 比で誤差レベル) |
| C. ローカル限定 text | A の `ローカル比率` 倍 |
| C'. ローカル限定 cw | B の `ローカル比率` 倍 |

**実測ローカル比率 ≒0.8% (35 万 / 4554 万) では**: C / C' は A / B の 1% 未満で誤差レベル。合計は実質 **A + B ≒ 6〜12 GB**。旧計画 (cw+text 連結式索引を text と別に持つ方式) の約半分で済む — OR 方式転換の副次的メリット。

note テーブル本体が仮に 100GB なら +6〜12% 増。許容範囲だが、SSD 容量計画には組み込む必要あり。

ローカル比率が高いインスタンス (90% 以上) では部分索引の削減幅そのものが小さくなるため、**C / C' を作らず A・B のみ** が正解になる。逆にローカル比率が低いインスタンス (本書の実測 0.8% など) では C / C' がデフォルト検索の保険として効く ([PGroonga検索Indexブラッシュアップ計画.md](PGroonga検索Indexブラッシュアップ計画.md) 3.3 節)。なお OR 方式では A が通常検索の唯一の索引なので、**「A を作らない」構成はどのローカル比率でも成立しない** (9.1 節の事故モードに直行する)。

### 7.2. 索引構築時間 (`CREATE INDEX CONCURRENTLY`)

- 4500 万行 × text 列で **約 5〜10 時間 / 索引** (SSD、メモリ十分、運用負荷低)。cw 系 (B / C') は対象データが極小なので**分オーダー**
- 索引の並行構築はせず、**1 本ずつシリアルに**構築する (CPU/IO 競合回避)
- 支配的なのは text 系 2 本 (A, C) で合計 **10〜20 時間** の見積もり → メンテナンスウィンドウとして数日を確保

### 7.3. INSERT への影響

- pgroonga 索引 1 本につき、INSERT 時に **トークン化 + posting list 更新** が走る
- 本計画では最大 4 本 (A, B, C, C') が note テーブルに乗るが、cw 系 2 本はほぼ NULL 列なので実質 **text 系 2 本分** のコスト
- 投稿ピーク時 (秒間 N 投稿) 影響目安:
  - N ≦ 100: 体感影響なし
  - 100 < N ≦ 1000: `work_mem` チューニングで対応可、INSERT レイテンシ +10〜30ms 程度
  - N > 1000: 専用チューニング + 監視必須。場合により書き込み専用 pgroonga 設定 (`tokenizer='TokenDelimit'` 等の軽量化) を検討
- **PGroonga は「更新中も検索性能を落とさない」設計** (公式・PDF 双方で明記) なので、書き込みと検索の競合は他の全文検索エンジンより小さい

### 7.4. 索引追加順の推奨

1. **A (text 全件)** を最初に投入 → 一番効くので動作確認しやすい
2. その後 **B (cw 全件)** — 構築は分オーダーなので A とセットで済ませてよい
3. 様子を見て **C / C' (ローカル限定 部分索引)** を追加
4. 不要だと判断したら DROP 可能 (B-tree ほど依存箇所が多くない)
5. **各段階で必ず代表クエリの `EXPLAIN (ANALYZE, BUFFERS)` を取り、pgroonga 索引が実際に使われていることを確認する** — 「張ったのに使われていない」は静かに起きる (9.1 節)

## 8. ロールアウト手順

1. ~~`SearchService` の coalesce バグ修正~~ (本ブランチで完了済)
2. **`SearchService` の textWithCw 経路を `(note.cw &@~ :q OR note.text &@~ :q)` へ変更** (3 節冒頭)。あわせて `SET LOCAL statement_timeout` の隣に `SET LOCAL jit = off` の追加を検討 (9.1 節 — 索引が効かないフォールバック時に JIT だけで 0.7 秒溶けた実測あり)
3. `.config/example.yml` / `docker_example.yml` の `sqlPgroonga` セクションに **A + B** の SQL を追記 (今回追記済 — OR 方式 + 4.1 のノーマライザ指定に合わせて改訂が必要)
4. `docs/search-index-tuning.md` (新規) に詳細案内
   - C / C' (ローカル限定部分索引) の SQL とローカル比率の見極め方
   - ノーマライザの「推奨版 (`unify_kana: true`) / 厳しめ版 (`unify_kana: false`)」併記
   - 索引投入後の EXPLAIN / `pg_indexes` での「本当に使われているか」確認手順 (4.4 / 9.1 節)
   - PGroonga セットアップ時の libgroonga バージョン競合の解消手順 (10 節参照)
   - 4500 万件級でのストレージ / 構築時間 / INSERT 影響の見積もり (本書 7 節を移植)
5. CHANGELOG に「textWithCw 検索対応 + 推奨索引の案内追加」
6. (別 PR) 6 節の発展案 (ハイライト・キーワード抽出・スニペット) の実装

## 9. 計測 / 検証

### 9.1. 実測ベースライン (2026-07 — 索引ミスマッチ事故の記録)

実環境で text / cw の列単独 pgroonga 索引 (TokenMecab + NFKC150) を張った状態のまま、**旧・連結式クエリ** (textWithCw + ローカル限定 + 検索語「ふぁぼすき」+ id レンジ + LIMIT 10) を `EXPLAIN (ANALYZE, BUFFERS)` した記録。**式が一致しないため pgroonga 索引は一切使われなかった**。

- **Execution Time: 6238 ms、ヒットわずか 8 件**
- 実際のアクセスパス: `BitmapAnd("userHost" IS NULL 索引 ≒35 万行 × PK の id レンジ ≒198 万行)` → Parallel Bitmap Heap Scan
- `&@~ 'ふぁぼすき'` は **Recheck / Filter として全行逐次評価** (可視性・ミュート・ブロック条件と一緒くた)
- ビットマップが work_mem に収まらず **lossy 化** (`Heap Blocks: exact=297 lossy=20475`)、`Rows Removed by Index Recheck: 162299` — lossy ブロックの recheck は coalesce + `&@~` の式評価を全行やり直すため特に高くつく
- `Buffers: shared read=76186` ≒ **600MB のディスク読み** (LIMIT 10 のクエリで)
- `JIT: Total 694 ms` — **LIMIT 10 のクエリに対して JIT コンパイルだけで約 0.7 秒**。索引が効けばコスト見積もりが下がって発動しなくなる見込みだが、フォールバック時の保険として `SET LOCAL jit = off` を検討 (8 節)

教訓:

1. **列単独索引は連結式クエリに使われない** (式完全一致縛り)。OR 形式への転換 (2.3 節) の直接の根拠。
2. pgroonga が効かないときのフォールバックは「id レンジ全走査 + Filter」で、レンジが広いと数百 MB 級の IO になる。`SET LOCAL statement_timeout = 15s` (SearchService 実装済) はこの事故モードへの保険として妥当。
3. 「索引を張ったのに使われていない」は**エラーにならず静かに起きる**。投入時の EXPLAIN 確認 (7.4 節) と `pg_stat_user_indexes.idx_scan` の継続監視 (下記) の両方が必要。

### 9.2. 投入前後で取る計測

A・B・C・C' 投入前後で取る:

- `EXPLAIN (ANALYZE, BUFFERS)` の代表クエリ
  - 短い日本語 (2 字) のローカル限定検索
  - 長い英語 + 添付フィルタ
  - host 指定 + textWithCw
  - ユーザー指定 + 通常検索
- `pg_relation_size('note')` および各索引のサイズ実測
- `pg_stat_user_indexes.idx_scan` で「作ったが使われない索引」を検出
- 検索 API の p50 / p95 レイテンシ
- INSERT 時の `pg_stat_statements.mean_exec_time` の推移
- **D 案 (`text, id` 同梱) 実証**: A 単体と比較して時系列 ORDER BY が改善するか

## 10. リスク / 注意点

- **libgroonga バージョン競合**: Ubuntu 24.04 では `libgroonga0t64` (13.1.1, Ubuntu 同梱版) と `libgroonga0` (16.0.5, Groonga 公式リポジトリ版) が共存し得る。古い方が `/lib/x86_64-linux-gnu/` に配置され先にロードされると `undefined symbol: grn_language_model_get_n_embedding_dimensions` エラーで `CREATE EXTENSION pgroonga` が失敗する。**`sudo apt remove libgroonga0t64` で古い方を削除し `sudo ldconfig` で解消**する。PGroonga セットアップ手順に明記すること。
- ノーマライザ A・B・C 不一致は実害が大きいのでドキュメントで強く釘を刺す (**実環境で発生済** — 4.4 節)。
- **btree 側の索引最適化 migration (1783062429920) の本番適用は `MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY=1` がほぼ必須**。素の `pnpm migrate` では note への CREATE INDEX が ACCESS EXCLUSIVE ロックを保持し、完了まで読み書きが全断する。入れ替え中は新旧索引が併存するため、対象索引サイズぶんのディスク余裕 (数 GB) も見込むこと。
- **索引が使われない事故は静かに起きる** (9.1 節で実証)。クエリ側の式変更 (連結⇔OR、coalesce の有無、キャスト) や部分索引の WHERE 条件と SearchService の条件のズレは、エラーではなく「遅くなるだけ」で現れる。SearchService 側でこれらの書き方を変えるときは EXPLAIN 確認をセットにする → **コード側の責務として明記**。
- 全文検索が索引フォールバックした場合、work_mem 不足で bitmap が lossy 化し recheck コストが跳ね上がる (9.1 節)。検索用コネクションの `work_mem` 設定もドキュメントで触れる。
- `CREATE INDEX CONCURRENTLY` は途中失敗すると `INVALID` 索引が残るので、`pg_index.indisvalid = false` のレコードを定期的にチェックして DROP する運用が必要。
- pgroonga バージョンアップ時に索引フォーマットが変わる場合がある (`REINDEX` 推奨)。MISTEMS 運用としてバージョン固定 or アップグレード手順を整備する。

## 11. TODO

- [ ] **SearchService の textWithCw 経路を OR 形式へ変更** (3 節冒頭のコード変更。これをしないと索引が使われないことは実測で確認済 — 9.1 節)
- [ ] **実環境の cw 索引を text と同一ノーマライザで張り直す** (4.4 節の不一致解消。cw は極小なので再構築は分オーダー)
- [ ] `unify_katakana_bu_sound` → `unify_katakana_v_sounds` 切り替えの検証 (4.1 節 — 「ヴァイオリン⇔バイオリン」を拾うなら v_sounds)
- [ ] `SET LOCAL jit = off` の効果検証 (9.1 節で JIT 694ms を実測。索引が効く状態でも発動するか確認)
- [ ] example.yml / docker_example.yml の索引 SQL を OR 方式 + 4.1 のノーマライザ指定に合わせて改訂
- [ ] `docs/search-index-tuning.md` 草稿 (本計画 7 / 9 節を中核に)
- [ ] ベンチスクリプト `scripts/bench-search.ts` 方針決め
- [ ] D 案 (`pgroonga (text, id)`) の実測 — aid 採番前提なら効果期待大、ベンチで効果を確認したら A / B / C / C' すべてを `(text, id)` / `(cw, id)` 形式に張り直す
- [ ] 6 節発展案 (ハイライト・キーワード抽出・スニペット) を別 issue 化
- [x] ~~(別タスク検討) 通常検索を `(coalesce(cw,'') || coalesce(text,''))` ベースに統一し索引を B 1 本に集約する案~~ → **廃案**。連結式索引そのものを不採用にしたため前提が消滅 (3 節)。式完全一致縛りの地雷と連結境界の偽マッチが理由。
- [ ] ローカル比率の実測 (`SELECT COUNT(*) WHERE userHost IS NULL / COUNT(*)`)。部分索引採用判断材料。
- [ ] PGroonga バージョン固定方針 / REINDEX タイミングの整備
- [ ] **NEologd 導入評価** (4.5 節)
   - PostgreSQL ホストへの配置・`/etc/mecabrc` 差し替え手順を整備
   - 効果計測: 代表クエリ (固有名詞・新語) で ipadic vs NEologd の検索ヒット率比較
   - 索引構築時間・サイズへの影響を実測
   - SudachiDict / PGroonga 公式 Sudachi 対応の動向ウォッチ
- [ ] **MISTEMS 固有名詞カスタム辞書の整備** (4.6 節)
   - private リポジトリ `mistems-mecab-dic` の初期化 (seed submodule + patches/ + CI)
   - **大量取得は Wikipedia ダンプから抽出するスクリプト整備** (jawiki カテゴリツリーから記事タイトル + 冒頭フリガナ取得)
   - **継続更新源としての未知語抽出スクリプト** (自インスタンスログから ipadic + NEologd で未知語化した連続形態素を集計 → 月次レポート → 人手レビューで patches/ に追加)
   - `left-id.def` を実環境で確認して 1290 の妥当性を検証
   - 略称と正式名称を両方登録するレビュー基準の文書化
   - **Steam / eShop / SNS クロールは明示的に「やらない」と決めて再発提案を防ぐ**
