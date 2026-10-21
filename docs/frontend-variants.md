# フロントエンド variant の運用手順

本番サーバーに複数のフロントエンドビルド（variant）を同居させ、Cookie で切り替えて動作確認するための仕組みです。MISTEMS 独自の機能です。

## 仕組み

Cookie `mk_fe_variant` の値に応じて、backend が HTML に埋め込む manifest を切り替えます。variant のビルド成果物は `frontend-variants/<name>/` に置かれ、本線のビルドとは別に配信されます。

variant を選択中の HTML には、左下にバッジ「FE: <name> ✕」が表示されます。variant の HTML は `Cache-Control: private, no-store` で返します。本線の HTML は従来どおり `public` です。

## variant の載せ方

1. Mac で機能ブランチを push します。
2. mistems-main の `frontend-variants.yml` に variant を追記して push します。

```yaml
- name: emoji-drop                   # 英数字・ハイフン・アンダースコア
  branch: riin/feat/emoji-drop-area  # origin にあるブランチ
  mode: merge                        # 省略すると merge
```

`mode` には次の値を指定できます。

- `merge`（既定）: mistems-main に squash merge したものをビルドする
- `as-is`: ブランチをそのままビルドする

## デプロイ手順への追加

サーバーのデプロイ手順で、`pnpm build` の後、再起動の前に次を 1 行実行します。

```bash
node scripts/build-frontend-variants.mjs
```

スクリプトは `frontend-variants.yml` を読み、variant ごとに `.frontend-variants-work/<name>` でビルドして `frontend-variants/<name>/` に入れ替えます。ビルドできなかった variant は `frontend-variants/_skipped.json` に理由が記録されます。

環境変数 `FRONTEND_VARIANTS_NO_FETCH=1` を付けると `git fetch --prune` を省略します。これはローカルでの動作確認専用です。本番では付けないでください。

## 切り替え方

- `/__fe` を開くと variant の一覧が表示される。選ぶと `/` に戻り、その variant が表示される
- 本線に戻すときは、左下のバッジをクリックする

## 取り込みでコンフリクトしたとき

`merge` モードで squash merge がコンフリクトした variant はスキップされ、`/__fe` の「ビルドできなかった variant」に理由が表示されます。その場合は、手元でコンフリクトを解消した統合確認ブランチを作って push し、`mode: as-is` で載せてください。

## 制約

- backend の変更を含むブランチは確認できない。variant は frontend のビルド成果物だけを差し替える
- 埋め込み（embed）は切り替わらない
- localStorage と IndexedDB は本線と共有される。設定の移行を含むブランチを試すと、本線に戻ったときに設定が壊れることがある
- variant 1 つにつき、デプロイ時間が数分、ディスクが数十〜百数十 MB 増える（言語ごとのディレクトリを含むため）

## CDN を使う場合

本線の HTML は `public` で返すため、CDN などの共有キャッシュの背後では、variant を選択中のユーザーに本線の HTML がキャッシュから返ることがあります。`mk_fe_variant` Cookie があるリクエストは、HTML のキャッシュを迂回するように CDN を設定してください。

## 注意事項

`/__fe/switch` は GET で variant を切り替えます。そのため、他のサイトに置かれたリンクから訪問者の variant を切り替えられます。変わるのは表示するフロントエンドだけで、権限は変わりません。
