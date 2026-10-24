# MISTEMS 開発ガイド

このリポジトリは Misskey のフォーク **MISTEMS** の開発用である。上流 (misskey-dev/misskey) の develop に、MISTEMS 独自の機能ブランチを squash merge して作る。本ファイルは MISTEMS 開発の唯一の規約で、上流の `AGENTS.md` と `CONTRIBUTING.md` は使わない (このブランチで削除済み)。

Claude Code 固有の補助 (skills / agents / slash commands) は `.claude/` 配下にある。個人ローカル設定は `.claude/settings.local.json`、MCP 認証情報は `.claude/.credentials.json` に置く (いずれも `.gitignore` 済)。

---

## remote

| remote | リポジトリ | 役割 |
| --- | --- | --- |
| `origin` | misskey-dev/misskey | 上流。本流の develop を取り込む元。**参照するだけで、書き込まない** |
| `systems` | mistems/mistems | MISTEMS の正本。統合済みの `mistems-main` とリリースのタグを置く |
| `riin` | fruitriin/misskey | 開発用。機能ブランチ、`riin/release/*`、claudeImplement などを置く |

ほかに、他の開発者のフォーク (`kakkokari-gtyih` など) を remote に登録している。上流に出ている他人の PR を取り込むときは、`party/<PR番号>-<名前>` のローカルブランチにして使う。

## 特殊ブランチ

| ブランチ | 役割 |
| --- | --- |
| `mistems-main` | デプロイ用の統合ブランチ。`main-統合.sh` を実行するたびに最新の `origin/develop` へ reset し、機能ブランチを squash merge して作り直す。**ここに直接コミットしない** (次の統合で消える) |
| `mistems-readme` | MISTEMS の README と `main-統合.sh` の公開用コピーだけを置く。`mistems-readme` スキルで更新する |
| `add-claude-github-actions-1762310148415` (claudeImplement) | MISTEMS 開発の共通ファイルの本拠地。本ファイル、`.claude/` のスキル・エージェント、開発用スクリプト、Claude Code の GitHub Workflow を置く。`main-統合.sh` で最初に squash merge される |

MISTEMS 開発全体で使うファイル (規約、スキル、開発ツール、共通の計画書) は claudeImplement にコミットする。mistems-main 上で直したくなったら、claudeImplement に反映してコミットし、`riin` へ push する。

## 開発の進め方

1. **機能ブランチを最新の `origin/develop` から切る**。古い develop や mistems-main から派生したブランチは、`rebase-to-develop` スキルで最新の develop に載せ直す
2. **1 機能 1 ブランチ**で実装し、`riin` に push する
3. **`main-統合.sh` に squash merge のエントリを足す** (`squash-prep` スキル)。統合はローカルで行い、GitHub 上ではマージしない
4. **統合時のコンフリクト**は `git rerere` に解消方法を覚えさせる。rerere がすべて自動で解消したときは、スクリプトがそのまま続行する。CHANGELOG.md は毎回破棄する
5. **互いにコンフリクトする機能**は、`riin/release/*` の統合ブランチにまとめてから squash merge する。`riin/release/*` 自体がコンフリクトしたときは、`rebuild-release-branch` スキルで元の機能ブランチから作り直す
6. 上流が同じ課題を解決したら、そのブランチは統合から外し、`main-統合.sh` の台帳の「栄誉の殿堂」に移す

### force push

develop への rebase や作り直しを日常的に行う開発スタイルなので、`riin` の自分のブランチ (機能ブランチ、`riin/release/*`、claudeImplement など) への force push は日常的に使ってよい。**ユーザーへの許可取りは不要**である。他人の push を上書きしないよう `--force-with-lease` を使う。`origin` (misskey-dev) へは、force push も通常の push もしない。

### 上流のファイルとの関係

規約や開発用ドキュメント (本ファイル、`.claude/` 配下、`.github/copilot-instructions.md` など) は、上流で変更があっても**原則として MISTEMS 側の内容を採用する**。更新頻度が低く、上書きしても失うものが少ないためである。統合でコンフリクトしたら、MISTEMS 側を残して解消する。

## README と CHANGELOG

MISTEMS の README (mistems-readme ブランチ、`mistems-readme` スキルで更新) の変更点リストと、`main-統合.sh` の自由帳にある CHANGELOG (MISTEMS のバージョンごとの変更点) は、次のように書く。

- **1 機能ブランチにつき 1 行**を基本にする
- 同じ機能をあとから改修・拡張したときは、**行を足さずに既存の行を書き換える**。改修のたびに行を重ねない
  - 例: 「ピッカーの検索がひらがな/カタカナを区別しなくなる」を、改修後は「ピッカーの検索がひらがな/カタカナ/大文字・小文字と全角・半角を区別しなくなる」に書き換える
- 統合から外した機能の行は消す。統合に戻したら行を戻す
- 上流の `CHANGELOG.md` は統合のたびに破棄されるので、ここには書かない

## 計画書

- 計画書は、その作業のブランチの `docs/` 配下に置く。MISTEMS 開発全体に関わる計画書は claudeImplement に置く
- **未完了の計画書は `docs/planning/`** に置き、**作業が完了したら `docs/` の直下へ移す** (`git mv` してコミットする)
- ファイル名は日本語にする。先頭に作成日を付ける (例: `docs/planning/2026-10-23-開発用シードデータ.md`)
- リポジトリのルートや `docs/superpowers/` などには置かない。superpowers などのスキルが別の場所を既定にしていても、本ルールを優先する

---

## 絶対にやってはいけない事

### コード・データ関連

1. **SPDX ヘッダー欠落のまま AGPL 管轄ディレクトリへ新規ファイルを追加しない**
   - 対象: 新規 `.ts` / `.js` / `.cjs` / `.mjs` / `.vue` / `.scss` / `.html` ファイル
   - 対象と判定は [scripts/check-spdx.mjs](scripts/check-spdx.mjs) が一元管理する
   - `node scripts/check-spdx.mjs` を 1 回実行し、欠落は `--fix` で補う。`SPDX: OK` なら追加の目視確認はしない
   - `packages/misskey-js` は MIT ライセンスのサブパッケージなので、この AGPL ヘッダーを一律に付けない (サブパッケージ固有の `package.json` / `LICENSE` / 既存ファイルのヘッダーに従う)

2. **`locales/ja-JP.yml` 以外の locale YAML を手動編集しない**
   - 他言語ファイル (`en-US.yml` など `ja-JP.yml` 以外すべて) は Crowdin の自動配信先。手動編集すると次の同期で上書き喪失する
   - 根拠: [locales/README.md](locales/README.md) と [crowdin.yml](crowdin.yml)

3. **マージ済 migration ファイルを編集しない**
   - 対象: `packages/backend/migration/{unixMs}-{name}.js` のうち、既に `develop` / `mistems-main` に入っているもの
   - 本番環境で履歴改変が起きると深刻なデータ不整合を引き起こす
   - スキーマ変更が必要な場合は **新しいタイムスタンプで新規ファイル** を作成する (`node -e "console.log(Date.now())"` でタイムスタンプ取得)
   - 新規 migration は `up()` と `down()` の両方を実装し、`pnpm --filter backend check-migrations` を通すこと

### Issue / PR / 外部送信

4. **ユーザーの明示指示なしに PR を merge / close しない** (ブランチへの force push は「force push」の節のとおり許可不要)
5. **ユーザーの明示指示なしに external service (GitHub comments / Slack / メール 等) へ送信しない**
6. **secrets / 認証情報をリポジトリにコミットしない** (`.config/*.yml` の本番値、`.env` ファイル、API token、private key 等)
7. **misskey-dev/misskey へは書き込まない**
   - misskey-dev の Issue・PR・コードは参考にするだけにとどめる
   - misskey-dev へのコメント、Issue の起票、PR の作成、リアクションはしない。コミットメッセージにも misskey-dev の PR / Issue 番号を書かない (参照通知が飛ぶため。参照先は `main-統合.sh` のコメントに URL で残す)
   - PR を作るときは `riin` または `systems` のリポジトリの中で作る

### スキル呼び出し

上流スキルの実行・事前知識・memory の内容に関わらず免除されない。

8. **`working-on-backend` スキルを参照せずに `packages/backend/` 配下のファイルを編集・追加しない**
9. **`working-on-frontend` スキルを参照せずに `packages/frontend/` 配下のファイルを編集・追加しない**
10. **`shipping-misskey-change` スキルを参照せずに commit / PR 作成 / 作業をユーザーに返さない**

---

## 変更を出す前の最低チェック

[shipping-misskey-change スキル](.claude/skills/shipping-misskey-change/SKILL.md) を参照すること。スキルが利用できない環境でも、以下のチェックは必ず実施すること:

1. **lint / test**: ESLint 対象の変更ファイルへ package root から `eslint --quiet` を最後に 1 回実行し、実装変更には最も近い test を選んで実行する。package / repo 全体 lint と広域 test は任意
2. **backend API 変更時**: `pnpm build-misskey-js-with-types` を実行し `packages/misskey-js/src/autogen/` の差分も commit に含めた
3. **entity / migration 変更時**: `pnpm --filter backend check-migrations` が pending DDL 0 件で通る / 新規 migration は `up()` と `down()` 両方実装済
4. **SPDX**: `node scripts/check-spdx.mjs` が `SPDX: OK` を返すことを確認する
5. **locale safety**: commit 済み・未commit・untracked の変更集合に `locales/ja-JP.yml` 以外の locale YAML が無いことを確認する
6. **CHANGELOG**: ユーザーが明示しない限り編集しない (統合時に破棄される)。ユーザー影響がある変更では引き継ぎに候補を 1 行だけ示す

### Validation commands

各チェックで使う pnpm コマンド一覧。状況に応じて最も近いコマンドから検証する。

| 用途 | コマンド |
| --- | --- |
| 全体 lint (任意) | `pnpm lint` |
| Backend unit test | `pnpm --filter backend test` |
| Backend e2e test | `pnpm --filter backend test:e2e` |
| Backend federation test | `pnpm --filter backend test:fed` |
| Frontend unit test | `pnpm --filter frontend test` |
| Migration 差分検査 (pending DDL) | `pnpm --filter backend check-migrations` |
| `misskey-js` 再生成 (API 変更後必須) | `pnpm build-misskey-js-with-types` |
| 全体ビルド | `pnpm build` |
| 開発サーバー | `orb-dev-server` スキル (ホストで `pnpm dev` を動かさない) |

**注意:** backend テスト (`test` / `test:e2e` / `test:fed`) 実行前に `.config/test.yml` が必要 (`cp .github/misskey/test.yml .config/test.yml` で作成)。
