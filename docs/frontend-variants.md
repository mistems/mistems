# フロントエンド variant の運用手順

本番サーバーに複数のフロントエンドビルド（variant）を同居させ、管理者が管理画面から切り替えて動作確認するための仕組みです。MISTEMS 独自の機能です。

## 仕組み

Cookie `mk_fe_variant` の値に応じて、backend が HTML に埋め込む manifest を切り替えます。variant のビルド成果物は `frontend-variants/<name>/` に置かれ、本線のビルドとは別に配信されます。

variant を選択中の HTML には、左下にバッジ「FE: <name> ✕」が表示されます。variant の HTML は `Cache-Control: private, no-store` で返します。本線の HTML は従来どおり `public` です。

切り替えは管理画面の「フロントエンド variant」ページ（`/admin/frontend-variants`）から行います。このページは管理者（`isAdmin`）にだけ表示されます。ページは `GET /__fe/variants.json` で一覧を取得し、選ばれた variant の名前を `mk_fe_variant` Cookie に自分で書き込んでから、ページを再読み込みします。

## variant の載せ方

1. Mac で機能ブランチを push します。
2. `main-統合.sh` の中で `frontend-variants.yml` を書き出している箇所に variant を追記し、統合し直します。MISTEMS では一覧を `main-統合.sh` で管理しているので、`frontend-variants.yml` を直接編集しないでください。

```yaml
- name: emoji-drop                   # 英数字・ハイフン・アンダースコア
  branch: feat/emoji-drop-area       # remote 上のブランチ名
  mode: merge                        # 省略すると merge
```

`mode` には次の値を指定できます。

- `merge`（既定）: mistems-main に squash merge したものをビルドする
- `as-is`: ブランチをそのままビルドする

## デプロイ手順への追加

サーバーのデプロイ手順で、`pnpm build` の後に次を 1 行実行し、その直後にプロセスを再起動します。

```bash
FRONTEND_VARIANTS_REMOTE=riin node scripts/build-frontend-variants.mjs
```

`FRONTEND_VARIANTS_REMOTE` には、サーバーの clone で fruitriin/misskey を指している remote の名前を指定します。省略すると `origin` を使います。

再起動を忘れると、backend が variant の一覧を古いまま保持します。必ずスクリプトの直後に再起動してください。

スクリプトは `frontend-variants.yml` を読み、variant ごとに次の処理をします。

- ブランチを明示的な refspec で fetch する
- `.frontend-variants-work/<name>` で install とビルドを実行する。制限時間は install が 15 分、`build-pre` が 5 分、フロントエンドのビルドが 30 分である（variant ごと。全体の上限はない）
- 成功した variant を、まとめて `frontend-variants/` ごと入れ替える。2 回目の rename に失敗したときは、ディレクトリの入れ替えだけを元に戻す
- ビルドに失敗した variant は今回の一覧から外れ、前回の成果物も残らない。その Cookie を持つ利用者は、黙って本線に戻る

スクリプトは失敗しても常に終了コード 0 で終わります。variant のビルド失敗で本線のデプロイが止まらないようにするためです。

結果は `frontend-variants/_variants.json` に書き出されます。形は次のとおりです。

```json
{
  "variants": [{ "name": "emoji-drop", "branch": "feat/emoji-drop-area", "mode": "merge" }],
  "skipped": [{ "name": "foo", "branch": "feat/foo", "reason": "..." }]
}
```

`skipped` の `reason` は決まった文言だけです。詳しいエラー内容はデプロイのログにだけ出力されます。ビルドできなかった理由を調べるときは、デプロイのログを確認してください。

環境変数 `FRONTEND_VARIANTS_NO_FETCH=1` を付けると、`git fetch` を省略します（全体の `--prune` 付きの fetch も、variant ごとの fetch も省略します）。これはローカルでの動作確認専用です。本番では付けないでください。

## 切り替え方

- 管理者で管理画面の「フロントエンド variant」ページを開き、variant を選ぶ。ページが再読み込みされ、その variant が表示される
- 本線に戻すときは、左下のバッジをクリックする。バッジは `/__fe/switch` へ移動して Cookie を消し、`/` に戻る
- バッジによる復帰は、管理画面のページを持たない variant（develop 基点の `as-is` ブランチなど）の中でも使える

`/__fe/switch` は引数を受け取りません。Cookie を消して `/` へリダイレクトするだけです。以前あった `?v=` による切り替えと、公開の `/__fe` 一覧ページは廃止しました。

## `/__fe/variants.json`

variant の一覧と現在の選択を返す公開エンドポイントです。`Cache-Control: private, no-store` で返します。

```json
{
  "current": "emoji-drop",
  "variants": [{ "name": "emoji-drop", "branch": "feat/emoji-drop-area", "mode": "merge" }],
  "skipped": [{ "name": "foo", "branch": "feat/foo", "reason": "..." }]
}
```

- `current` は Cookie から決まる現在の variant 名である。本線のときは `null` である
- 認証なしで誰でも読めるため、ブランチ名が公開される。リリース候補だけを載せる運用で、これを許容している

## 取り込みでコンフリクトしたとき

`merge` モードで squash merge がコンフリクトした variant はスキップされ、`_variants.json` の `skipped` に記録されます。管理画面のページにも、ビルドできなかった variant として表示されます。その場合は、手元でコンフリクトを解消した統合確認ブランチを作って push し、`mode: as-is` で載せてください。

## 信頼境界

`frontend-variants.yml` に載せたブランチの install script とビルドは、本番 VPS のデプロイ権限で実行されます。載せたブランチのコードは、デプロイ権限を持つ人のコードと同じ扱いです。信頼できるリリース候補だけを載せてください。

Cookie は署名していません。管理者以外でも、`mk_fe_variant` Cookie を手で書けば variant を表示できます。変わるのは表示するフロントエンドだけで、権限は変わりません。この点は許容しています。

## ビルド負荷

variant のビルドは、本番と同じ VPS で variant ごとに実行します。メモリに余裕がないときは、載せる variant を減らしてください。

## キャッシュ

本線の HTML には `Cache-Control: public, max-age=30` が付いています。variant が 1 つでもあるとき、backend は HTML 応答に `Vary: Cookie` を付けるので、`Vary` を守るブラウザや CDN では、切り替えた直後でも Cookie に合った HTML が返ります。`Vary` を無視するキャッシュでは、最大 30 秒ほど古い HTML が返ることがあります。表示が変わらないときは、少し待ってから再読み込みしてください。

## 制約

- backend の変更を含むブランチは確認できない。variant は frontend のビルド成果物だけを差し替える
- 埋め込み（embed）は切り替わらない
- localStorage と IndexedDB は本線と共有される。設定の移行を含むブランチを試すと、本線に戻ったときに設定が壊れることがある
- variant 1 つにつき、デプロイ時間が数分、ディスクが数十〜百数十 MB 増える（言語ごとのディレクトリを含むため）

## CDN を使う場合

本線の HTML は `public` で返すため、CDN などの共有キャッシュの背後では、variant を選択中のユーザーに本線の HTML がキャッシュから返ることがあります。`mk_fe_variant` Cookie があるリクエストは、HTML のキャッシュを迂回するように CDN を設定してください。
