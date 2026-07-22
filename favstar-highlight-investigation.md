# ハイライト集計ロジック / 集計タイミング 調査メモ

「リアクションベースでキュレーションしたつもりだが不完全」とのことなので、現状の実装を集計タイミング / 集計値 / 表示判定の3軸でほどいてみました。結論として、**バックエンド側のキュレーションとフロントエンドの色付け判定が完全に独立しており、リアクション除外設定や採用確率がフロントの色付けに反映されない** という構造的なズレがあります。

---

## 1. 集計タイミング

| トリガ | コード | スコア | rateFactor | excludeEmojis | 備考 |
|---|---|---|---|---|---|
| **リアクション付与** | `ReactionService.createReaction` `packages/backend/src/core/ReactionService.ts:212-231` | `+1` | 適用 | 適用 | セルフリアクション除外、3日以内のノートのみ |
| **リノート作成** | `NoteCreateService.incRenoteCount` `packages/backend/src/core/NoteCreateService.ts:902-914` | `+5` | 適用 | **未適用** | リノートも Featured ランキングに乗る |

つまり「ハイライトの集計」は厳密にはリアクションだけではなく、**リアクション + リノート** の合算スコアで Redis sorted set (`featuredGlobalNotesRanking` 等) を更新しています。リアクション以外も寄与している時点で「リアクションベース」とは言い切れません。

## 2. 集計値と表示判定の不整合（本丸）

### バックエンドが管理しているもの
`FeaturedService.updateGlobalNotesRanking` ほかが Redis sorted set にスコア累積。これは **「みつける / フィーチャー」タイムラインに何を出すか** を決めるためのもの。

- `highlightRateFactor` … スコア加算の発生確率（既定 30%）
- `highlightExcludeEmojis` … リアクションのみ、特定絵文字をスコア加算から除外
- 3日以内のノートのみ集計対象
- セルフリアクション・チャンネル外の `replyId != null` 等を除外

### フロントエンドが色付けに使っているもの
`MkNote.vue:67`

```vue
<div :class="[$style.text, {
  [$style.akafav]: featured && note.reactionCount >= highlightPopularityThreshold.highPopularity,
  [$style.aofav]: featured && note.reactionCount >= highlightPopularityThreshold.midPopularity
                  && note.reactionCount < highlightPopularityThreshold.highPopularity
}]">
```

ここで使っている `note.reactionCount` は `NoteEntityService.ts:414` で次のように計算されているもの。

```ts
reactionCount: Object.values(reactions).reduce((a, b) => a + b, 0),
```

つまり **そのノートに付いた全リアクション数の単純合計**。`highlightExcludeEmojis` のフィルタも採用確率もここには一切効きません。

### 帰結する問題

1. **`highlightExcludeEmojis` がフロント色付けに無効**
   除外指定した絵文字でリアクションされても `reactionCount` には含まれるため、それだけで赤ふぁぼ/青ふぁぼに到達してしまう。ユーザの「キュレーションしたつもり」は Featured タイムラインに乗るか乗らないかの選別にしか効いていない。

2. **`featured` プロップが `explore.featured.vue` でしか `true` にならない**
   `MkNotesTimeline.vue` の他の経由（ホーム TL 等）は `featured=false` のままなので、Featured タイムライン以外では絶対に色が付かない。「リアクションたくさんついたノートは青ふぁぼ／赤ふぁぼ」という README の説明（スコープ言及なし）と実装の挙動が食い違っている。

3. **赤ふぁぼ閾値の境界条件**
   `note.reactionCount >= midPopularity && < highPopularity` で青、`>= highPopularity` で赤。`mid` を `high` 以上に設定すると青のレンジがゼロになる。バリデーション無し。

4. **Featured ランキングのスコアと表示色が乖離**
   - リノートはランキングに +5 寄与するが `reactionCount` には影響しない → 「Featured 上位なのに色が付かないノート」が出る。
   - 逆に Featured に乗らない（rateFactor で間引かれた）ノートでも、`featured=true` の文脈で表示されればリアクションが多ければ色が付く。Featured 上の他人のリアクションでもカウントされるので、自然な体験ではあるが「ランキング = 色付け」ではない。

## 3. `highlightExcludeEmojis` 自体のパース問題

`ReactionService.ts:212`

```ts
const excludeEmojis = this.meta.highlightExcludeEmojis.split(/:\n/).filter(v => v);
```

- 区切り文字が **`:\n` というシーケンス**。つまり「`:` の直後に LF」がある時のみ分割される。
- 管理画面の入力 (`MkTextarea`) には `:emoji_name:` を改行区切りで並べる想定だが、
  - 末尾要素には改行が無く `split` 対象外 → 最後の `:emoji_name:` がそのまま残る
  - 先頭の `:` は最初の要素にだけ残り、その後の要素は `emoji_name:` で始まる文字列になる
  - 結果、要素の文字列フォーマットがバラバラに
- 比較対象の `reaction` は内部表現上 `:name@.:` / `:name@host:` 形式なので、`includes(reaction)` がそもそもまずマッチしない可能性が高い。
- Unicode 絵文字の場合は `reaction` が生の絵文字文字列（`👍` 等）だが、入力テキストは `:thumbsup:` 系の MFM 表記であり、これも一致しない。

→ **実質的に「除外絵文字」設定はほぼ常に効いていない可能性が大**。

## 4. `update-meta.ts` の保存ロジック

`packages/backend/src/server/api/endpoints/admin/update-meta.ts:778`

```ts
if (ps.highlightRateFactor) {
    set.highlightRateFactor = ps.highlightRateFactor;
    set.highlightMidPopularityThreshold = ps.highlightMidPopularityThreshold;
    set.highlightHighPopularityThreashold = ps.highlightHighPopularityThreashold;
    set.highlightExcludeEmojis = ps.highlightExcludeEmojis;
}
```

- 4つを **`highlightRateFactor` の truthy 判定一発でまとめてセット**している。
- `highlightRateFactor` を 0 にした（＝ハイライト機能を停止したい）ケースで、他3項目の更新も無視される。
- 個別に `!== undefined` 判定で `set.x = ps.x` するのが正しい形。

## 5. その他細かい点

- `paramDef` 側で `optinal: false` (タイポ。`optional` ではない) になっており、`type-narrowing` 上は最適化されない。
- フィールド名 `highlightHighPopularityThreashold` も `Threashold` → `Threshold` のタイポが各所に伝播している（DB カラム名含むので修正には migration 必要）。
- リノート側 `incRenoteCount` には `excludeEmojis` フィルタ無し（そもそも絵文字無関係なので問題ではないが、`highlightRateFactor` を「リアクション採用確率」と説明している admin 画面と齟齬）。

---

## 修正方針の提案

「リアクションベースでキュレーション」を素直に実現するなら、選択肢は2つ。

### A. フロント側で `note.reactions` を再集計する（小手先・既存DB変更なし）
`MkNote.vue` の色付け判定で `note.reactionCount` ではなく、`instance.highlightExcludeEmojis` を反映した「除外後リアクション数」を `computed` で算出する。

メリット: マイグレーション不要、最小差分。
デメリット: 除外絵文字のパース仕様をフロントで正規化する必要がある（前述 3 の問題を片付ける）。`featured` プロップに依存している現状の表示スコープ制限はそのまま。

### B. キュレーション結果をノートに乗せる（本筋）
`NoteEntityService.pack` 内で `featuredService.isHighlighted(noteId)` 的に判定して、サーバ側で `highlightTier: 'mid' | 'high' | null` を返す。フロントは `featured` プロップではなくこの値を見て色付け。

メリット: ロジックがサーバ集約、リノート寄与も含めた本来の「ハイライト」体験が全画面で一貫。
デメリット: pack 毎の Redis 参照コスト、または事前に Note カラムへ反映するマイグレーション。

### 直すべき最低限のバグ修正（A/B どちらでも）

- [ ] `highlightExcludeEmojis.split(/:\n/)` の区切り仕様見直し（改行区切り＋トリム＋カスタム絵文字フォーマット正規化）
- [ ] `update-meta.ts:778` の `if (ps.highlightRateFactor)` ガードを項目別 `!== undefined` に分解
- [ ] `paramDef` 内の `optinal` タイポ修正
- [ ] (低優先) `Threashold` カラム名のリネーム（migration 込み）
- [ ] `MkNote` の `featured` フラグでの表示スコープ制限を意図通りか確認（ホーム TL でも色を出すなら撤廃）
