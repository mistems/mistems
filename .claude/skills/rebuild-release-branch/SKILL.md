---
name: rebuild-release-branch
description: main-統合.sh 実行中に riin/release/* ブランチがコンフリクトしたとき、統合ブランチ (mistems-main) 上でその場しのぎに解決するのではなく、release ブランチを構成する元の機能ブランチを特定し、rebase-to-develop スキルで各機能ブランチを最新 origin/develop に乗せ直してから release ブランチを再構成して push するスキル。"/rebuild-release-branch"、"releaseブランチを作り直す"、"release のコンフリクトを元ブランチで直す"、"統合で release がコンフリクトした" 等の発話、および main-統合.sh 実行中に riin/release/* の squash merge がコンフリクトした場面で起動する。
---

# rebuild-release-branch

`riin/release/*` ブランチ（複数の機能ブランチを束ねたリリース用ブランチ）が `main-統合.sh` の squash merge でコンフリクトしたとき、**元の機能ブランチ側を修正して push する**スキル。

## なぜ統合ブランチ上で解決してはいけないか

mistems-main 上でコンフリクトを解決すると rerere に記録され次回は自動解決されるが、release ブランチ自体は古い develop ベースのまま残る。すると:

- develop が進むたびに同じ箇所が毎回コンフリクトする（rerere が効かない環境では毎回手作業）
- release ブランチと機能ブランチの内容が乖離していき、どれが正か分からなくなる
- 機能ブランチ単体を本家に PR する際の品質が落ちる

根本対応は「機能ブランチを最新 develop に rebase → release ブランチを最新 develop から再構成」である。

## 入力

```
/rebuild-release-branch riin/release/FavstarAndTimemachine
```

引数なしで起動された場合は、直前の統合作業でコンフリクトした `riin/release/*` ブランチを対象とする。

## 処理フロー

### 0. 統合の続行と release 作り直しは両方やる

統合中に release がコンフリクトしてこのスキルが起動された場合、「統合をその場で通す」と「release を作り直す」は二者択一ではなく**両方実施する**。

- コンフリクトが rerere で自動解決されている場合（マーカー残存なし・unstaged のまま停止）は、解決内容を検証したうえで `git add` → スクリプト記載のコミットを実行し、当日の統合はそのまま通してよい
- ただしそれで終わりにせず、**必ず手順 1〜6 で release ブランチを作り直す**。作り直さない限り release は古い develop ベースのままなので、次回の統合で同じコンフリクトが再発する

### 1. 構成ブランチの特定

release ブランチがどの機能ブランチから構成されているかを以下の順で調べる:

1. **main-統合.sh のコメント** — squash_merge エントリの直前・直後のコメントに構成が書かれていることが多い（例: `# riin/favstar (favstar-rebased を採用・リネーム済) + riin/timemachine`）
2. **マージコミット** — `git log --merges --oneline riin/release/<name>` でマージ元ブランチ名を確認
3. **ブランチ名からの推定** — 例: `FavstarAndTimemachine` → `riin/favstar` + `riin/timemachine`。`git branch -a | rg -i '<キーワード>'` で実在を確認

特定した構成ブランチ一覧をユーザーに提示し、認識が合っているか確認してから先へ進む。

### 2. バックアップ作成

```bash
git branch backup/release-<name>-$(date +%Y%m%d) riin/release/<name>
```

### 3. 機能ブランチを最新 develop に乗せ直す

各構成ブランチについて **rebase-to-develop スキル** を呼び出して最新 `origin/develop` 派生に作り直し、force push まで完了させる（diff 提示・承認フローは rebase-to-develop 側の規約に従う）。

構成ブランチのうちコンフリクトの原因になっているものだけでなく、**全構成ブランチを乗せ直す**。一部だけ新しいと release 再構成時に機能ブランチ同士のベース差でまたコンフリクトする。

### 4. release ブランチの再構成

最新 develop から作り直し、rebase 済みの機能ブランチを順にマージする:

```bash
git switch -c <一時ブランチ> origin/develop
git merge --no-ff riin/<feature-1>
git merge --no-ff riin/<feature-2>
```

ここで発生するコンフリクトは**機能同士の真のコンフリクト**なので、ここで解決する（例: 両機能が paginator.ts の同じ位置にプロパティを追加 → 両方残す）。解決内容は機能間の統合コミットとして release ブランチに残る。

### 5. 検証

旧 release と新 release の「develop に対する固有 diff」を比較し、意図しない差分（機能の欠落・余計な混入）がないか確認する:

```bash
git diff $(git merge-base backup/release-<name>-<date> origin/develop) backup/release-<name>-<date> --stat
git diff origin/develop HEAD --stat
```

ファイル一覧レベルで一致していること（＋コンフリクト解決分の差）を確認して報告する。

### 6. push と後片付け

force push は破壊的操作なので、diff とバックアップ ref を提示してユーザーの承認を得てから実行する:

```bash
git push riin HEAD:refs/heads/release/<name> --force-with-lease
```

push 後:

- mistems-main 側の統合を再実行（またはコンフリクトした squash merge からやり直し）して、コンフリクトが解消されたことを確認する
- rerere に旧解決が残っていて新しいマージ結果と食い違う場合は `git rerere forget <file>` で消す
- 一時ブランチ・古い backup ref の削除はユーザーに確認してから行う

## 経験の記録
（実行時に任意で追記）

- 2026-07-21: `riin/release/FavstarAndTimemachine` が `packages/frontend/src/utility/paginator.ts` でコンフリクト（**本家 develop の itemRemovalDelay (#17708, TransitionGroup 廃止)** と timemachine 側の allowPartial が同位置に追加。当初 FTTL 修正由来と誤記していたが `git log -S itemRemovalDelay` で本家由来と確認済み）。このときは統合ブランチ上で両方残す解決を行い rerere に記録したが、本来はこのスキルの手順で release を再構成すべきケース。
- 2026-07-21: `riin/release/mkPages-mkDraggable` を本スキルの手順で再構成。機能同士の真のコンフリクト（page-editor/common.ts と page-editor.el.text.vue の `dragStartCallback` → `pointerStartCallback` 改名 × mkPages のツールバー追加）は rerere の過去解決が正しく適用された。統合側で後から当てた fix（navbar @click ラムダ化のような vue-tsc 対応）は rerere の解決に含まれないので、再構成時に織り込み忘れないこと。
- 2026-07-22: FavstarAndTimemachine の paginator.ts コンフリクトが予告通り再発（前日に統合側で解決したのみで release 未再構成だったため）。rerere は自動解決するがファイルをステージしないため、統合スクリプトは「未解決」として停止する。この再発を受けて手順 0（統合続行 + release 再構成の両方を必須化）を追加。同日の再構成作業で得た教訓:
	- **コンフリクト解決後は必ずツリー全体でマーカー残存を grep する** (`git grep -l '^<<<<<<<' -- packages`)。1ファイルに複数のコンフリクト領域があることがあり、1箇所だけ直して add するとマーカーごとコミットされる（timemachine の MkNote.vue で実際に発生、amend + cherry-pick で復旧）
	- 解決の正しさは「旧 diff と新 diff の `--numstat` を per-file で突き合わせ」で機械的に検証できる。行数が数十行ずれたファイルはマーカー混入や解決ミスのシグナル
	- rerere の解決に「統合ブランチでしか入らないはずの変更」が見えても、`git log -S <識別子>` で出所を確認してから汚染と断定する（itemRemovalDelay は本家 develop 由来で rerere は正しかった。誤って `rerere forget` してしまった）
	- `git apply -3` はコンフリクト時に unmerged index を作り、その瞬間 rerere が再発火して記録済み解決を上書き適用してくる。rerere を迂回して手動解決したい場合は index を経由せずファイルを直接構成して `git add` する
