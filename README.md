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

- 投稿フォーム
  - チャンネルピッカー　追加
  - 宛先チャンネル表示　追加
  - CWと本文の入れ替えボタン　追加
- チャンネル一覧
  - だいたいぜんぶみるタブ　追加（もっと→チャンネル）

- チャンネル周り全般
  - 既存の投稿ボタンと通常公開範囲の投稿ボタンを両方置く
- 検索にpgroongaを使う
  - 全文検索が日本語とても上手になります
  - 既存のMeiliSearchを使ったサーバーでもconfの設定の変更が必要 詳しくは https://github.com/misskey-dev/misskey/pull/14978

- ノート周辺
  - リノート先/元のチャンネル名を表示  
  - リアクションのビューアに読み仮名などを表示

- リアクションピッカー
  - 検索がひらがな/カタカナを区別しなくなる
  - カテゴリが閉じている状態でも先頭4個は見えている状態になる
 
- ハイライト
  - リアクションがたくさんついたノートは青ふぁぼになったり赤ふぁぼになったりする
  - 何個で色が変わるかはコンパネ＞全般から設定すること

- 接続が再開したとき「サーバーから切断されました」のメッセージを消す

- 絵文字管理画面に絵文字管理画面（グリッド）を先行導入

- ショートカットキー
  - h でショートカットキーヘルプ

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
git fetch samunohito
git fetch kakkokari-gtyih
git fetch ikasoba
git fetch nakkaa
git switch mistems-main
git reset origin/develop --hard

# コンフリクトチェック用の関数
function check_conflicts
    if git status --porcelain | grep -q "^U"
        echo "コンフリクトが発生しました。手動で解決してください。"
        echo "解決が完了したら 'Y' を入力してください（それ以外は終了します）: "
        read -l response
        if test "$response" != "Y"
            echo "スクリプトを終了します。"
            exit 1
        end
    end
end

# gitコマンドをラップする関数
function git
    if test "$argv[1]" = "commit"
        check_conflicts
        command git $argv
    end
    command git $argv
end
 

git switch mistems-main
git reset origin/develop --hard

# MkPostFormの宛先にチャンネルを追加, 翻訳を追加 swap-CW
# チャンネルの既読を同期, registory-item endpointを追加 router.definition, main-boot
# 追加, MkHelp, 
git merge --squash  riin/mkPostFormExtend # チャンネル既読の同期を統合
git commit -a -m "投稿機能周の拡張"

git merge --squash riin/channelIndex 
git commit -a -m "チャンネルだいたいぜんぶみる" # フォローとお気に入りの説明を統合
git merge --squash riin/mkNoteExtend 
git commit -a -m "MkNote拡張（チャンネルRenoteどこからきてどこへいくのか）"

# ノートに表示されているリアクションにホバーしたときに出るやつ MkReactionsViewer.details.vue
git merge --squash riin/emojiDetailDialog
git commit -a -m "MkReactionViewer拡張（よみがなさっと見る）" # ここまで2025.10.0 おわり

# ピッカーの入力補助機能拡張
# MkEmojiPicker.vue と packages/frontend/src/custom-emojis.ts で カタカナをひらがなに寄せる
git merge --squash riin/emojiPickKanaConv
git commit -a -m "絵文字検索ひらカナ大統一"

# ピッカーのリストから選ぶ方の機能
# packages/frontend/src/components/MkEmojiPicker.section.vue
git merge --squash riin/emojiChotMiel 
git commit -a -m "絵文字ちょっと見えてほしい"

git merge --squash riin/hashtag-mutable
git commit -a -m "ハッシュタグでミュートできるようにする"

# 検索を本文のみと 本文+CWにできるように
git merge --squash riin/search-enhance
git commit -a -m "ノート検索の強化"

git merge --squash riin/MkNoteDetailed-loadReplies
git commit -a -m "MkNoteDetailedで返信を読み込む"


git merge --squash kakkokari-gtyih/fix-stream-indicator 
git restore --staged CHANGELOG.md
git restore CHANGELOG.md
git commit -a -m "WSが再開したらサーバー切断メッセージを閉じる"
git merge --squash riin/block-mentions-from-unfamiliar 
git commit -a -m "無名のユーザーからの通知を拒否する(MisskeyIO/misskey/#462)"

git merge --squash riin/annoy-logs-goneto-debuglevel
git commit -a -m "正常系ログをデバッグレベルに落とす"

git merge --squash riin/add-claude-github-actions-1762310148415
git commit -a -m "Add Claude Code GitHub Workflow"
# コンフリクトしたので取り込んでない
# git merge --squash riin/favstar &&\
# git commit -a -m "ふぁぼすたーを感じる機能" &&\

# コンフリクトしたので取り込んでない
# git merge --squash riin/safe-rss &&\
# git commit -a -m "saferRSS" &&\

# コンフリクトの修正が必要
#git merge --squash riin/readble-message-ratelimitservice 
#git commit -a -m "BRIEF_REQUEST_INTERVAL を人間に意味のあるメッセージにする" 
# git merge --squash riin/timemachine
# git commit -a -m "実験的.タイムマシン"

set MISVER 75
set file_path "package.json"
# JSONからversionを取得 -MISTEMS.XX を追加した新しいバージョンを作成
set current_version (jq -r '.version' $file_path)
set new_version "$current_version-MISTEMS.$MISVER"

# package.jsonのversionを新しいものに書き換え
jq --arg new_version "$new_version" '.version = $new_version' $file_path > tmp.json && mv tmp.json $file_path
npx prettier -w $file_path

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

