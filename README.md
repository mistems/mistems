# MISTEMS

ほしい機能詰め込み改造Misskey  
諸般の事情により実際にデプロイするブランチは mistems-main で mistems-readme ブランチはダミーである  
mistems-mainの現在の差分はおそらくこちら  
https://github.com/misskey-dev/misskey/compare/develop...mistems:mistems:mistems-main


## 変更点

このPRをだいたいぜんぶ入れる
https://github.com/mistems/mistems/pulls

- セキュリティ
  - 内側から誰もフォローしていないインスタンスからのメンションを拒否する
  - パスワードレス+TOTP併用時のサインインをパスワード経由ではTOTPに統一

- 投稿フォーム
  - チャンネルピッカー　追加
  - 宛先チャンネル表示　追加
  - CWと本文の入れ替えボタン　追加
  - センシティブワードを含む投稿に警告・ハイライト表示

- チャンネル一覧
  - だいたいぜんぶみるタブ　追加（もっと→チャンネル）

- チャンネル周り全般
  - 既存の投稿ボタンと通常公開範囲の投稿ボタンを両方置く
  - チャンネルの既読を同期

- 検索
  - 検索を本文のみと本文+CWで切り替えられるように
  - 検索UIの改善、期間指定ショートカット（今日・直近3日）追加
  - ノート検索のインデックス最適化

- ノート周辺
  - リノート先/元のチャンネル名を表示
  - リアクションのビューアに読み仮名などを表示
  - MkNoteDetailedで返信を読み込む

- リアクションピッカー
  - 検索がひらがな/カタカナを区別しなくなる
  - カテゴリが閉じている状態でも先頭4個は見えている状態になる
  - 絵文字ピッカーを開いた後に背景更新で動かないようにする

- ハイライト・タイムマシン
  - リアクションがたくさんついたノートは青ふぁぼになったり赤ふぁぼになったりする
  - 何個で色が変わるかはコンパネ＞全般から設定すること
  - タイムマシン（過去のタイムラインを遡れる）

- ページエディター
  - MkPagesエディター拡張（プレビューのタブ化）
  - ドラッグアンドドロップのスマホ拡張とアニメーション

- ハッシュタグ
  - ハッシュタグでミュートできるようにする

- クリップ
  - clipへのノート登録レートリミットを 20→100 へ緩和

- UI・UX
  - 接続が再開したとき「サーバーから切断されました」のメッセージを消す
  - 接続切断Tipがモーダル表示中にクリックできない問題を修正
  - ショートカットキー h でショートカットキーヘルプ

- バグ修正
  - 通知の残カウントバグを直す
  - FTTLの歯抜けバグ修正
  - 添付ファイルのエンコーディングがSJISになるバグの修正
  - 添付されるテキストのエンコーディングを修正
  - エラー画面で操作不能になることがあるのを修正
  - すべてのアカウントからログアウトされる問題を修正
  - ドライブの選択状態持ち越しバグの修正

- 開発・運用
  - 正常系ログをデバッグレベルに落とす
  - Claude Code GitHub Workflow追加（Issue, PRでClaudeが反応）

# 開発者向けドキュメント
## MISTEMSの作り方

リモートブランチにたいして squash mergeする  
CHANGELOGはしぬほどコンフリクトするのでなかったことにする  
それ以外のコンフリクトは git rerere で解除方法を覚えてもらう  

具体的には以下のようなshellscriptを実行している

```
#!/usr/bin/env fish

git fetch origin
git fetch riin
git switch mistems-main
git reset origin/develop --hard

# ブランチ存在チェック付き squash merge
function squash_merge
    set -l branch $argv[1]
    if not command git rev-parse --verify $branch >/dev/null 2>&1
        echo "エラー: ブランチ '$branch' が見つかりません。スクリプトを終了します。" >&2
        exit 1
    end
    command git merge --squash $branch
    # CHANGELOG.md は毎回破棄するので、コンフリクト判定の前に解消
    command git checkout HEAD -- CHANGELOG.md 2>/dev/null
    # CHANGELOG.md 以外にコンフリクトがあったらストップ
    if command git status --porcelain | grep -q "^U"
        echo "コンフリクトが発生しました ($branch)。手動で解決してください。"
        echo "解決が完了したら 'Y' を入力してください（それ以外は終了します）: "
        read -l response
        if test "$response" != "Y"
            echo "スクリプトを終了します。"
            exit 1
        end
    end
end


git switch mistems-main
git reset origin/develop --hard


squash_merge riin/add-claude-github-actions-1762310148415
git commit -a -m "Add Claude Code GitHub Workflow(Issue, PRでClaudeが反応), mistems skill"


squash_merge riin/channelIndex
git commit -a -m "チャンネルだいたいぜんぶみる" # フォローとお気に入りの説明を統合

squash_merge riin/mkNoteExtend
git commit -a -m "MkNote拡張（チャンネルRenoteどこからきてどこへいくのか）"

# ノートに表示されているリアクションにホバーしたときに出るやつ MkReactionsViewer.details.vue
squash_merge riin/emojiDetailDialog
git commit -a -m "MkReactionViewer拡張（よみがなさっと見る）" # ここまで2025.10.0 おわり

# ピッカーの入力補助機能拡張
# MkEmojiPicker.vue と packages/frontend/src/custom-emojis.ts で カタカナをひらがなに寄せる
squash_merge riin/emojiPickKanaConv
git commit -a -m "絵文字検索ひらカナ大統一"

# ピッカーのリストから選ぶ方の機能
# packages/frontend/src/components/MkEmojiPicker.section.vue
squash_merge riin/emojiChotMiel
git commit -a -m "絵文字ちょっと見えてほしい"

squash_merge riin/hashtag-mutable
git commit -a -m "ハッシュタグでミュートできるようにする"

# 検索を本文のみと 本文+CWにできるように
squash_merge riin/search-enhance
git commit -a -m "ノート検索の強化"

squash_merge riin/index-optimize
git commit -a -m "ノート検索のインデックス大改造"


squash_merge riin/MkNoteDetailed-loadReplies
git commit -a -m "MkNoteDetailedで返信を読み込む"

squash_merge kakkokari-gtyih/fix-stream-indicator
git commit -a -m "WSが再開したらサーバー切断メッセージを閉じる"

squash_merge riin/block-mentions-from-unfamiliar
git commit -a -m "無名のユーザーからの通知を拒否する(MisskeyIO/misskey/#462)"


squash_merge riin/annoy-logs-goneto-debuglevel
git commit -a -m "正常系ログをデバッグレベルに落とす"

squash_merge riin/fix/notification-unread-count
git commit -a -m "通知の残カウントバグを直す"

squash_merge riin/release/mkPages-mkDraggable
git commit -a -m "MkPagesエディター拡張/ドラッグアンドドロップのスマホ拡張とアニメーション"



squash_merge riin/fix/fanout-timeline
git commit -a -m "FTTLの歯抜けバグ修正"


# riin/favstar (favstar-rebased を採用・リネーム済) + riin/timemachine
squash_merge riin/release/FavstarAndTimemachine
git commit -a -m "タイムマシンとふぁぼった"



squash_merge riin/fix-textfile-encode
git commit -a -m "添付ファイルのエンコーディングがSJISになるバグの修正"



# MkPostFormの宛先にチャンネルを追加, 翻訳を追加 swap-CW
# チャンネルの既読を同期, registory-item endpointを追加 router.definition, main-boot
# 追加, MkHelp, 投稿フォームでセンシティブワードを警告・ハイライト表示
squash_merge  riin/mkPostFormExtend # チャンネル既読の同期を統合
git commit -a -m "投稿機能周の拡張"


squash_merge riin/fix/error-page-unhandled
git commit -a -m "fix(frontend): エラー画面で操作不能になることがあるのを修正"


squash_merge  riin/fix-textfile-encode
git commit -a -m "fix: 添付されるテキストのエンコーディングを修正"


squash_merge riin/clips
git commit -a -m "enhance: clipへのノート登録レートリミットを 20->100へ緩和"


squash_merge kakkokari-gtyih/fix-signout
git commit -a -m "fix(frontend): すべてのアカウントからログアウトされる問題を修正"

# https://github.com/fruitriin/misskey/pull/50
squash_merge riin/claude/2fa-register-key-auth-error-w3c1m5
git commit -a -m "fix(backend): パスワードレス+TOTP併用時のサインインをパスワード経由ではTOTPに統一"

# https://github.com/fruitriin/misskey/pull/49
squash_merge riin/fix/emoji-picker-resize-when-arrive-new-note
git commit -a -m "fix(frontend): 絵文字ピッカーを開いた後に背景更新で動かないようにする"

squash_merge riin/claude/awesome-volta-vljoz9
git commit -a -m "fix(frontend): 接続切断Tipがモーダル表示中にクリックできない問題を修正"

squash_merge riin/drive
git commit -a -m "fix(frontend): ドライブの選択状態持ち越しバグの修正"


# pnpm run build-misskey-js-with-types
# git commit -a -m "mistems-main.build-misskey-js-with-types 再生成"

set MISVER 97
set file_path "package.json"
# JSONからversionを取得 -MISTEMS.XX を追加した新しいバージョンを作成
set current_version (jq -r '.version' $file_path)
set new_version "$current_version-MISTEMS.$MISVER"

# package.jsonのversionを新しいものに書き換え
jq --arg new_version "$new_version" '.version = $new_version' $file_path > tmp.json && mv tmp.json $file_path
npx prettier -w $file_path

# mistems-readme ブランチから README.md をコピー
git show riin/mistems-readme:README.md > README.md

echo "Version updated to: $new_version"
git commit -a -m "Version updated to: $new_version"
git tag -a "$new_version" -m "MISTEMS.$MISVER"
```

### 管理用ブランチ

- mistems-main  - 後述の方法で misskey/develop 最新に機能ブランチを取り込んだブランチ デプロイするときはこれを使う コミットログはあまり当てにならない
- mistems-readme - READMEが置いてあるだけで何も無い

### ブランチの取り込み方
PRのと見込みはGitHub上ではなくローカルで行う
```
git merge --squash 任意ブランチ
git commit -a -m "メッセージ"
```

### squash マージ同士の共存（コンフリクトの解除）
コンフリクトした場合、適宜解決する
が、毎回コンフリクト解除するのはやってられないので、 git rerere に乗っかる

【Git】同じコンフリクト解消を繰り返している人に教えたい「git rerere」 #初心者 - Qiita https://qiita.com/_ken_/items/64856e91e062b325590f

### 機能ブランチを最新に追従させる方法
feature ブランチを rebase してコンフリクトを解除したのち、mainでsquashする
featureブランチが複数のコミットからなっていて繰り返しコンフリクトする場合、コミットを1つに圧縮する
