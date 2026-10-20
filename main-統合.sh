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
    set -l merge_status $status
    # NOTE: grep は rg の alias なので使わない (rg -c はマッチ 0 件で無出力になる)
    set -l unmerged (command git ls-files -u | count)
    # merge が失敗したのにコンフリクトが無い = stash failed 等の異常終了。
    # ただし rerere が全コンフリクトを自動解消済み (staged あり) なら正常系として続行する
    if test $merge_status -ne 0 -a $unmerged -eq 0
        if command git diff --cached --quiet
            echo "エラー: ブランチ '$branch' のマージに失敗しました (exit status: $merge_status)。スクリプトを終了します。" >&2
            exit 1
        end
    end
    # CHANGELOG.md は毎回破棄するので、コンフリクト判定の前に解消
    command git checkout HEAD -- CHANGELOG.md 2>/dev/null
    # CHANGELOG.md 以外にコンフリクトがあったらストップ
    # ただしマーカー残存なし = rerere が全て自動解決済みなので、ステージして続行する
    # (rerere は解決してもステージしないため git add が必要)
    if command git status --porcelain | command grep -q "^U"
        set -l conflicted (command git ls-files -u | command awk '{print $4}' | command sort -u)
        if command grep -q '^<<<<<<<' $conflicted
            echo "コンフリクトが発生しました ($branch)。手動で解決してください。"
            echo "解決が完了したら 'Y' を入力してください（それ以外は終了します）: "
            read -l response
            if test "$response" != "Y"
                echo "スクリプトを終了します。"
                exit 1
            end
        else
            echo "rerere により自動解決済み ($branch): $conflicted"
            command git add -- $conflicted
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

# -------------------------------------
# squash_merge riin/mkPages
# git commit -a -m "MkPagesエディター拡張"
# riin/mkdraggable-animation
# git commit -a -m "MkDraggable アニメーションとスマホ対応"

squash_merge riin/release/mkPages-mkDraggable
git commit -a -m "MkPagesエディター拡張/ドラッグアンドドロップのスマホ拡張とアニメーション"
# --------------------------------------



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


# コンフリクトしたので取り込んでない
# squash_merge riin/safe-rss &&\
# git commit -a -m "saferRSS" &&\

# コンフリクトの修正が必要
#squash_merge riin/readble-message-ratelimitservice
#git commit -a -m "BRIEF_REQUEST_INTERVAL を人間に意味のあるメッセージにする"


#  #17533
squash_merge riin/fix/error-page-unhandled
git commit -a -m "fix(frontend): エラー画面で操作不能になることがあるのを修正"


#--------------------
#
# squash_merge  riin/mkdraggable-animation
# git commit -a -m "fix(frontend): スマホでのドラッグアンドドロップ修正"


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

squash_merge riin/fix/resync-charts-timeout
git commit -a -m "fix(backend): resyncCharts が statement timeout で失敗する問題を修正"

# unhandled rejection の leak 元 URL を特定する診断パッチ (本修正は URL 特定後)
squash_merge riin/fix/http-request-abort-timer
git commit -a -m "debug(backend): node-fetch の AbortError に request.url を含める診断パッチ"

# フォロー数が多いユーザーのホームタイムライン DB フォールバックが
# キャッシュ非ウォーム時に数秒〜十秒級の遅延を起こす問題の高速化 (LATERAL 方式)
squash_merge riin/fix/timeline-dbfallback-lateral
git commit -a -m "perf(backend): フォロー数が多いユーザーのホームタイムライン DB フォールバックを高速化"

# FileServerService の errorHandler は /files/:key (drive) と /proxy/:url* (画像プロキシ) で
# 共有されているが、エラーログに発生元リクエストの情報が無く追跡できなかった問題の改善
# (MISTEMS 限定運用、upstream には出さない)
squash_merge riin/fix/file-server-error-log-context
git commit -a -m "fix(backend): FileServerService のエラーログにリクエスト情報を追加"

# System/UserWebhookDeliverProcessorService が同名ロガー('webhook')を使っていて
# ログの出自(system/user どちらか)が判別できず、System 側のエラーログにも
# webhookId が無かった問題の改善 (MISTEMS 限定運用、upstream には出さない)
squash_merge riin/fix/webhook-log-context
git commit -a -m "fix(backend): webhook 配送処理のロガーを system/user で区別し、失敗ログに webhookId を追加"

# X 埋め込み展開時、ダークテーマだと color-scheme 不一致で iframe の透過背景が白く描画される問題
# NOTE: ローカルブランチ (worktree: misskey-worktrees/fix-x-embed-color-scheme)。riin へ push したら riin/ プレフィックスに読み替えること
squash_merge fix-x-embed-color-scheme
git commit -a -m "fix(frontend): ダークテーマ時にX (Twitter) ポスト展開でカード周囲の余白が白く表示される問題を修正"

# [上流マージ済み・統合除外 2026-09-24] リモートノート掃除ジョブのカーソル永続化
# 本家 develop に misskey-dev#17957 として同等機能がマージされたため、MISTEMS 側のブランチは不要になった。
# 復帰条件: 本家実装が revert された場合のみ再検討
# squash_merge riin/perf/clean-remote-notes-cursor
# git commit -a -m "enhance(backend): cleanRemoteNotes のカーソルを Redis に永続化し前回の続きから再開するように"

# [上流マージ済み・統合除外 2026-09-24] クリーナーのタイムアウト耐性
# 上記 #17957 にタイムアウト耐性も含まれているため同時に除外
# squash_merge riin/fix/clean-remote-notes-delete-timeout
# git commit -a -m "fix(backend): リモートノートクリーナーのタイムアウト耐性を強化 (minId/idWindow/DELETE)"


# ---- 仮氏パーティ (misskey-dev の kakkokari-gtyih PR 取り込み) ----
# NOTE: ブランチはローカル party/* として整備済。riin へ push したら riin/ プレフィックスに読み替えること
# 詳細は 仮氏パーティ.md を参照

# iPhone PWA で音が鳴らないのを解消する必要がある
# https://github.com/misskey-dev/misskey/pull/16974
# squash_merge party/16974-multitab-sound
# git commit -a -m "複数タブでMisskeyを開いている場合、そのうちの一つだけでサウンドを再生するように (misskey-dev#16974)"

# https://github.com/misskey-dev/misskey/pull/17770
squash_merge party/17770-reversi-timer
git commit -a -m "リバーシの制限時間がバックグラウンドで遅れる問題を修正 (misskey-dev#17770)"

# https://github.com/misskey-dev/misskey/pull/17158
squash_merge party/17158-htl-onboarding
git commit -a -m "ホームタイムラインが空のとき「みつける」やローカルに誘導するように (misskey-dev#17158)"

# https://github.com/misskey-dev/misskey/pull/15049
squash_merge party/15049-announce-reset-reads
git commit -a -m "お知らせの既読をリセットできるように (misskey-dev#15049)"

# https://github.com/misskey-dev/misskey/pull/17474
#squash_merge party/17474-drafts-menu
#git commit -a -m "投稿フォームの下書き・予約投稿メニューを整理 (misskey-dev#17474)"

# https://github.com/misskey-dev/misskey/pull/14933
squash_merge party/14933-bsky-embed
git commit -a -m "blueskyの投稿埋め込み表示に対応 (misskey-dev#14933)"

# https://github.com/misskey-dev/misskey/pull/16891
#squash_merge party/16891-follow-search
#git commit -a -m "フォロー・フォロワーを検索できるように (misskey-dev#16891)"

# https://github.com/misskey-dev/misskey/pull/17758
# NOTE: custom-emojis.ts で「絵文字検索ひらカナ大統一」とコンフリクトする。
#       解消方針: PR の新 fetchCustomEmojis を採用し、ひらカナ正規化は setCustomEmojis 内に移設 (rerere 学習済)
squash_merge party/17758-emoji-cache
git commit -a -m "カスタム絵文字の更新をサーバーに確認してクライアントキャッシュを更新するように (misskey-dev#17758)"

# ---- 仮氏パーティ ここまで ----


# fix: instance チャートの smallint 溢れと、チャート UPDATE 失敗時にバッファが増え続ける問題 (本家 Issue/PR 予定)
# NOTE: chart/core.ts の「Updated」ログ行で「正常系ログをデバッグレベルに落とす」とコンフリクトする。
#       解消方針: 本entry の try/catch 構造を採用しつつ、ログレベルは debug を維持 (rerere 学習済 2026-09-08)
squash_merge riin/fix/instance-chart-smallint-overflow
git commit -a -m "fix(backend): チャート UPDATE 失敗時にバッファが増え続ける問題と instance チャートの smallint 溢れを修正"

pnpm run build-misskey-js-with-types
git commit -a -m "misskey-js autogen 再生成 (仮氏パーティ統合後の整合)"

set MISVER 110
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

# tag が systems に push 済みなら MISVER の上げ忘れなので止める。
# 未 push なら -f で打ち直す (統合やり直し時に手動 git tag -d が不要になる)
if command git ls-remote --tags systems "refs/tags/$new_version" | command grep -q .
    echo "エラー: tag $new_version は既に systems へ push 済みです。MISVER を上げてください。" >&2
    exit 1
end
git tag -a -f "$new_version" -m "MISTEMS.$MISVER"



exit

--------------------------------------------------------
ここから自由帳.md

■ ローカルブランチ台帳 (2026-09-08 棚卸し。コミットが私たち名義のもの)

凡例 (行頭の作業進捗タグ。MISTEMS 軸 → 上流軸の順に併記):
[統合済み]       main-統合.sh で squash_merge 済み (mistems-main に入っている)
[統合待ち（要チェック）]       実装完了だが main-統合.sh に未収載 (統合するかの判断待ち含む)
[上流レビュー中] misskey-dev に PR 提出済み (OPEN)
[上流準備中]     misskey-dev へ提出予定・準備中 (PR 未提出、または DRAFT)
[上流マージ済み] misskey-dev に取り込まれた
[作業中]         実装・計画が進行中
[保留]           コンフリクト等で停止中
[退避]           バックアップ・素材の保管
[残骸]           整理対象
[運用]           常用インフラ (進捗の概念なし)
補足: 行中の [上流#n] は misskey-dev の Issue/PR 番号

◇ 統合・リポジトリ運用
[運用] mistems-main — 統合ブランチ本体 (origin/develop + 全機能 squash)
[運用] mistems-readme — README 配信元 (統合時に git show で取り込む)
[統合済み] add-claude-github-actions-1762310148415 — Claude GitHub Actions + mistems スキル (スキルの本籍)
[上流レビュー中] add-pnpm-permissions — .claude の pnpm パーミッション追加 [上流#17616]

◇ チャンネル・ノート表示
[統合済み] channelIndex — チャンネルだいたいぜんぶみるタブ
[統合済み] mkNoteExtend — チャンネル Renote の出所表示 + リノートティッカー
[統合済み] MkNoteDetailed-loadReplies — ノート詳細で返信を自動読み込み
[統合待ち（要チェック）] claude/renote-lock-feature-7J0NA — リノートロック [上流#17554 CLOSED → MISTEMS 向け。2026-09-08 squash 時のマーカー混入を修復済]
[統合済み] hashtag-mutable — ハッシュタグをメニューからミュート
[保留] safer-rss — RSS の安全化 (コンフリクトで統合保留中)

◇ 絵文字・リアクション
[統合済み] emojiDetailDialog — リアクションビューアに読み仮名など表示
[統合済み] emojiPickKanaConv — 絵文字検索ひらカナ大統一
[統合済み][上流レビュー中] fix/emoji-picker-resize-when-arrive-new-not — ピッカーが新着でぴょこぴょこする問題 [上流#17773]
[作業中] fix-emojipicker-movebug-arrivenote — キーボード表示中にドロワーが新着でずれる問題 (viewport 対応)

◇ 検索
[統合済み] search-enhance — ノート検索強化 (本文/CW 切替・UI 改善) + PGroonga 計画書
[統合済み] index-optimize — 検索インデックス最適化

◇ 投稿フォーム・エディタ・D&D
[統合済み] mkPostformExtend — 投稿フォーム機能拡張 (チャンネル宛先・センシティブ警告・既読同期ほか)
[統合済み] mkPages — ページエディタ narrow タブ切替 (release 経由)
[統合済み] mkdraggable-animation — MkDraggable アニメーション + オートスクロール (release 経由)
[上流レビュー中] mkdraggable-pointerevents — MkDraggable の PointerEvents 対応 [上流#17535]
[作業中] feat/mk-draggable-swipe-tansition — MkDraggable トランジション改善
[統合済み] release/mkPages-mkDraggable, rebuild/mkPages-mkDraggable — ↑の統合用 release

◇ タイムマシン・ふぁぼったー
[統合済み][作業中] timemachine — タイムマシン本体 (release 経由で統合済み)。フィードバック対応計画書で改修中
[統合済み] favstar-rebased — ふぁぼったー (squash 済み、release 経由)
[統合済み] release/FavstarAndTimemachine — ↑2つの統合用 release
[作業中] fix-mkpaginator-type — paginator の allowPartial 特性化テスト+代替実装 (未コミット作業のみ。タイムマシン期の上流 PR 準備の名残と推定)

◇ タイムライン (FTT)
[統合済み] fix/fanout-timeline — FTTL 歯抜けバグ修正
[上流レビュー中] fix/fanout-timeline-redis-gap — Redis 中間ギャップを DB フォールバックで補完 [上流#17549]
[上流準備中] fix/fanout-timeline-toggle-purge — FTT トグル時に Redis をパージ [上流#17548 DRAFT]
[退避] preserve/fttl-untilid-fallback — untilId 範囲外 DB フォールバック改造の退避
[統合済み] fix/timeline-dbfallback-lateral — HTL DB フォールバックの LATERAL 高速化

◇ バックエンド運用・ログ (MISTEMS 限定多め)
[統合済み] annoy-logs-goneto-debuglevel — 正常系ログを debug レベルへ
[統合済み] fix/file-server-error-log-context — FileServer エラーログにリクエスト情報
[統合済み] fix/webhook-log-context — webhook ロガーの system/user 区別
[作業中] fix/slow-query-log-context — スロークエリログへのコンテキスト付与 (計画書のみ、実装これから)
[上流マージ済み] fix/page-content-debug-log — PageService の console.log 除去 [上流#17834 MERGED]
[統合済み] fix/http-request-abort-timer — AbortError 診断 + unhandled rejection 修正
[上流レビュー中] fix/inbox-jsonld-unrecoverable — Inbox LD-Signature の不要リトライ抑止 [上流#17615]

◇ DB パフォーマンス・チャート
[上流マージ済み] perf/clean-remote-notes-cursor — cleanRemoteNotes カーソル永続化 → 栄誉の殿堂へ（本家 #17957 で同等機能マージ）
[上流マージ済み] fix/clean-remote-notes-delete-timeout — クリーナーのタイムアウト耐性 → 栄誉の殿堂へ（本家 #17957 に含まれる）
[統合済み] fix/resync-charts-timeout — resyncCharts の statement timeout 修正
[上流レビュー中] fix/resync-charts-statement-timeout — ↑の上流 PR 用切り出し [上流#17778]
[統合済み][上流準備中] fix/instance-chart-smallint-overflow — instance チャート smallint 溢れ修正 [上流Issue#17930・PR これから]
  （fix/instance-chart-requests-overflow は同一コミットの別名）
[作業中] perf/stats-reaction-count-estimate — /api/stats のリアクション数を reltuples 概算に
[作業中] claude/review-performance-widget-keMRa — DB パフォーマンスウィジェット

◇ 通知
[統合済み][上流レビュー中] fix/notification-unread-count — 通知残カウントバグ + 100 件打ち切り [上流#17530]
[退避] claude/issue-26-20260505-0757 — ↑の元となった fork Issue #26 の作業ブランチ
[作業中] list — 通知の未読バッジが消えない問題 （#17427 関連）
[統合済み] block-mentions-from-unfamiliar — 無名リモートユーザーからのメンション拒否

◇ 単発 fix
[統合済み][上流準備中] fix-textfile-encode — 添付テキストの文字コード UTF-8 化 [上流#17578 DRAFT]
[統合済み] fix-x-embed-color-scheme — X 埋め込みのダークテーマ白背景修正
[統合済み][上流レビュー中] fix/error-page-unhandled — エラー画面で操作不能 [上流#17533]
[上流レビュー中] error-page-escape — エラーページ HTML エスケープ (上流レビュー対応中)
[統合済み] drive — ドライブ選択状態持ち越しバグ
[統合済み] clips — クリップのレートリミット緩和
[作業中] ririca/instance-origin-decouple — instance_url meta から apiUrl/wsOrigin を導出

◇ 仮氏パーティ (他者 PR の develop 派生 rebuild。取捨は上の仮氏パーティのセクション参照)
[統合済み] party/14933-bsky-embed / 15049-announce-reset-reads / 17158-htl-onboarding / 17758-emoji-cache / 17770-reversi-timer
[保留] party/16891-follow-search / 16974-multitab-sound / 17474-drafts-menu — スクリプト上コメントアウト中
※ party/pr-* は上流 PR の生コピー (コミット他者名義) のため台帳対象外

◇ backup/*
[退避] backup/* 17 本 — 作業前退避。`git branch --list 'backup/*'` 参照

◇ 残骸候補 (整理対象)
[残骸] blank-image — 名前と無関係にタイムマシン開発の旧作業ブランチ
[残骸] renote-lock — mistems-main の MISTEMS.93 時点スナップショット (機能本体は claude/renote-lock-feature-7J0NA)
[残骸] timeout — mistems-main の MISTEMS.103 時点スナップショット
[残骸] fanout-rebase / loadReplies-rebase / mkNoteExtend-rebase / favstar-rebase / favstar-backup-01da813237 / tmp-release-FavstarAndTimemachine — rebase 作業の中間残骸
[残骸] release/mkPostExtendAndTimemachine / releate/clips-and-draggable (typo) — 旧 release 試行
[残骸] hoge / tmp / claudeImplement (同名 worktree の実体は add-claude-github-actions…) / release/mkPages-mkDraggablee — 独自コミットなし
[残骸] riin/ プレフィックス付きローカルブランチ 5 本 (riin/claude/2fa-register-key-auth-error-w3c1m5,
  riin/claude/awesome-volta-vljoz9, riin/claude/gallant-hamilton-1jmatx, riin/drive,
  riin/fix/emoji-picker-resize-when-arrive-new-note) — push/switch 時の事故で出来た残骸
  ※ 注意: rev-parse はローカルの riin/... を remote-tracking より先に解決するため、
     本スクリプトの squash_merge riin/... はこれらを掴む。現状 5 本ともリモートと同一 SHA で
     実害なし (2026-09-08 確認) だが、リモート更新でズレるので早めの削除を推奨


■ riin リモート専用ブランチ (2026-09-08 棚卸し。ローカルに対応ブランチが無いもの。タグは上の凡例と同じ)

◇ 統合・上流
[統合済み] emojiChotMiel — 絵文字ちょっと見えてほしい (ローカル削除済み。統合スクリプトは riin/emojiChotMiel を直接参照)
[上流レビュー中] mkdraggable-sp — MkDraggable タッチイベント追加版 [上流#17534]

◇ 構想・計画・素材
[作業中] channel-federation — チャンネル連合の実装 + 計画 (2026-08)
[作業中] claude/channel-federation-plan-fqtna3 — 同計画書の連合モード enum 方式改稿版
[退避] speculative/owner-checksheet — 要オーナー確認事項の一括チェックシート
[退避] speculative/terms-drafts — 利用規約ドラフト (ペルソナ並列レビュー反映)
[退避] speculative/channelindex-hashtags-cleanup — MkChannelIndex の未使用宣言 cleanup 案
[退避] claude/renote-lock-feature-3xf6P — リノートロックの設計書
[退避] claude/checkout-time-machine-VvPem — タイムマシン追加ロジックの unit test 素材

◇ 実装ありだが未統合 (要チェック)
[統合待ち（要チェック）] claude/issue-26-20260510-1119 — MkPages テキストブロックに MFM ツールバー (Phase 2)
[統合待ち（要チェック）] claude/misskey-pr-34-continue-5YwvL — 添付ファイル D&D を専用ハンドルからの操作に変更 (fork PR#34 続き)
[統合待ち（要チェック）] claude/remote-emoji-refetch-2nbU9 — リモートノート再取得の改善 (fork PR#35 レビュー反映)
[統合待ち（要チェック）] fix-clips-pagination — my/clips ページネーション末尾判定の修正
[統合待ち（要チェック）] fix/timeline-moreview — タイムライン自動「もっと見る」
[統合待ち（要チェック）] fix-channel-menu — チャンネルメニュー修正
[統合待ち（要チェック）] fix/mkpoll-ReferenceError — MkPoll の ReferenceError 修正
[保留] readble-message-ratelimitservice — レートリミットメッセージの可読化 (統合スクリプトでコメントアウト中・要コンフリクト修正)

◇ 吸収済み・置換済み (リモート削除候補)
[残骸] sync-channel-lastread — チャンネル既読同期 → mkPostFormExtend に吸収
[残骸] systems/swap-cw — CW⇔本文入れ替え (prefix 事故名) → mkPostFormExtend に吸収
[残骸] claude/hide-channel-timeline-button-t64Bp — チャンネルで LTL 投稿ボタンを隠す → mkPostFormExtend の設定に発展
[残骸] dragable-attachfile-mkpostform / claude/issue-25-20251122-1244 — 添付ファイル並べ替えの旧版
[残骸] claude/exciting-keller-rkmsvy — 絵文字ピッカー修正の旧版 (統合済み版の前身)
[残骸] claude/fix-database-queries-i0dvC — fix/clean-remote-notes-delete-timeout へ cherry-pick 済み
[残骸] claude/issue-19-20251105-0248 / -0535 — 自動「もっと見る」の試行 (fix/timeline-moreview が後継)
[残骸] claude/issue-21-20251105-0636 / -1607 — タイムマシン初期実装 (現行 timemachine に置換)
[残骸] claude/issue-23-20251121-0356 / -0425 / -20251122-1241 / -1247 — クリップページネーションの試行 (fix-clips-pagination が後継)
[残骸] claude/readme-mistems-main-sync-ac8grd — README 同期の旧作業 (mistems-readme 運用に置換)
[残骸] channel-function-description — チャンネルのフォロー/お気に入り説明 → channelIndex に統合
[残骸] streamIndicator — WS 切断メッセージ自作版 (kakkokari 版を統合済み)
[残骸] customEmojiManager2I-mistems / customEmojiMetakey / emojiUnicordYomiFix — 絵文字管理・ヨミ修正の旧作業 (2025-10)
[残骸] fix-safari-toplevelawait-workaround — Safari toplevel await の一時ワークアラウンド

◇ 2023〜24 年の旧ブランチ (リモート削除候補)
[残骸] chore/be-buildchain / -2 / -3、feat/launch-standalone-frontend、feat/pro-emoji-editor、
       feature/colorize-channel-post-form、feature/default-post-target-detect-from-path、
       feature/emoji-detail-picker-show-more-info、feature/post-channel-everywhere、
       fix/backend-script-start、fix/lint-error-post-form、fix/route-drive-folder (+ -picked)、
       fix/ruby-justify、refactor/develop-local-reload、refactor/notes、story/mkNote

◇ push 事故 (リモート削除候補)
[残骸] riin/claude/2fa-register-key-auth-error-w3c1m5、riin/claude/awesome-volta-vljoz9、
       riin/claude/gallant-hamilton-1jmatx、riin/drive、riin/fix/emoji-picker-resize-when-arrive-new-note
       — サーバー上に "riin/" 二重プレフィックス名で出来たブランチ (ローカルの riin/ 残骸を push した事故)。
       中身は正規ブランチと同じ。`git push riin --delete '<名前>'` で削除可

※ 別名 (ローカル台帳のエントリと同一コミットなので個別掲載しない):
   safe-rss = safer-rss / favstar = favstar-rebased /
   fix/emoji-picker-resize-when-arrive-new-note = ローカル …-new-not /
   mkPostFormExtend = ローカル mkPostformExtend (docs 2 コミット分だけローカルが先行)

--------------------------------------------------------

■ 栄誉の殿堂
本家の方に入ったのでもう不要


riin/perf/clean-remote-notes-cursor + riin/fix/clean-remote-notes-delete-timeout
  cleanRemoteNotes のカーソル永続化 + タイムアウト耐性強化。
  → 本家 misskey-dev#17957 (2026-09 develop マージ済み) で同等のカーソル永続化が実装されたため
    MISTEMS.110 で統合から除外 (2026-09-24)。
  復帰条件: 本家 #17957 が revert された場合のみ再検討。

riin/enhance/emoji-grid-keyshortcuts (2025-10-02, "EmojiGrid MacのCommand Keyで操作できるようにする")
→ 1週間後の misskey-dev#16621 (2025-10-09, develop統合済み)
  「[カスタム絵文字beta]MacのCmdキー対応とCtrl/Cmd+Arrowキー対応」が
  Ctrl/Cmd 両対応でより上位互換な形で同一課題を解決したため squash_merge から除外。
  復帰条件: develop 側から #16621 相当の実装が失われた場合のみ再検討。
  （2026-07-31 main-統合.sh 実行時にコンフリクトして判明、リモートブランチは削除済み）


----------------------------------------------------------------

■ CHANGELOG

CHANGELOG 104
- お知らせの既読をリセットできるように
- 複数タブでMisskeyを開いている場合、そのうちの一つだけでサウンドを再生するように
- ホームタイムラインが空のとき「みつける」やローカルに誘導するように
- リバーシの制限時間がバックグラウンドで遅れる問題を修正
- blueskyの投稿埋め込み表示に対応
- フォロー数が多い(50人以上いる)ユーザーを対象に、タイムライン構築の内部処理を変更（高速化）
- ダークモードで X.com の埋め込みに余白が白く出るのを修正
- メンションのオートコンプリート高速化


CHANGELOG 97
- 検索のINDEX最適化
- ドラッグアンドドロップでウィジェットが設定・削除できなくなったデグレを修正


CHAGELOG 96
- クリップボードからのテキスト添付のエンコードがutf-8になったが表示のときにエンコード指定がない問題の修正
- パスワードレス+TOTP併用時のサインインをパスワード経由ではTOTPに統一
-  絵文字ピッカーを開いた後に背景更新で動かないようにする
- 接続切断Tipをクリックすると後ろに判定が抜けるのを修正
- 投稿フォームでセンシティブワードを警告・ハイライト表示
- ドライブの選択状態をフォルダを越えて持ち越してしまうバグの修正（たぶん）
- MkPagesのプレビューが横幅が足りないとき段落ちするのを修正（タブ化）
- 検索のUIが読みにくかったのが改善
- 検索のUIに期間指定今日と直近３日のショートカットを追加

MISTEMS は個人開発です。現在支援によって生計を支えています
より長く活発な改善を続けるため、よろしければOFUSE等で支援お願いします
https://ofuse.me/memberships/4681 https://ofuse.me/memberships/2610

