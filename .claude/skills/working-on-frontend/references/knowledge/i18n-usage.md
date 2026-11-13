# i18n 使い分け / 他言語ファイルの扱い / トラブルシュート

`i18n.ts` / `i18n.tsx` の使い分け、Crowdin との同期メカニズムと MISTEMS での他言語ファイルの扱い、頻発する型エラー / 実行時警告の対処を 1 箇所にまとめたページ。

## 目次

- [基本: ts と tsx の使い分け](#基本-ts-と-tsx-の使い分け)
- [実装パターン](#実装パターン)
- [他言語ファイルの扱い (Crowdin と MISTEMS)](#他言語ファイルの扱い-crowdin-と-mistems)
- [トラブルシュート](#トラブルシュート)
- [制約と補足](#制約と補足)

## 基本: ts と tsx の使い分け

文言は **必ず** [i18n.ts](../../../../../packages/frontend/src/i18n.ts) 経由で参照する。引数の有無で **使う変数名そのものが変わる**。間違えると、非パラメータキーを `i18n.tsx` で呼ぶ場合は型エラーになるが、パラメータキーを `i18n.ts` で参照する場合は型エラーにならず `{name}` 等が未展開のまま画面に出る (後述のトラブルシュート参照)。

- 引数なし → `i18n.ts.<key>` (プロパティアクセス)

  ```ts
  os.toast(i18n.ts.removed);
  ```

- 引数あり → `i18n.tsx.<key>(...)` (関数呼び出し)

  ```ts
  os.alert({ type: 'info', text: i18n.tsx.unfollowConfirm({ name: user.username }) });
  ```

  YAML 側に `{name}` 形式のプレースホルダが含まれているキーは **`i18n.tsx`** からしか呼べない。誤って `i18n.ts.unfollowConfirm` と書くと値がフォーマット前の関数になってそのまま表示される。

- **既存キーの再利用が第一**。新キー追加が必要に見えても、まず `locales/ja-JP.yml` を grep して `deleteAreYouSure({ x })` のような汎用キー (`x` プレースホルダ) が転用可能でないか確認する。新キー追加は [tasks/adding-i18n-key.md](../tasks/adding-i18n-key.md)。他言語ファイルでは、上流にあるキーを手で触らない (MISTEMS 独自のキーは `en-US.yml` にも訳を足す)

```vue
<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

const props = defineProps<{ name: string }>();

async function onDelete() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.driveFileDeleteConfirm({ name: props.name }), // 引数あり
	});
	if (canceled) return;
	os.toast(i18n.ts.removed); // 引数なし
}
</script>
```

| 用途 | 書き方 |
|---|---|
| 単純文字列 | `i18n.ts.save` |
| ネスト | `i18n.ts._settings.general` |
| パラメータ付き (1 個) | `i18n.tsx.unfollowConfirm({ name })` |
| パラメータ付き (複数) | `i18n.tsx.monthAndDay({ month, day })` |
| Vue テンプレート内 | `{{ i18n.ts.save }}` / `{{ i18n.tsx.unfollowConfirm({ name }) }}` |

## 実装パターン

### HTML タグ埋め込み

ja-JP.yml の値に `<b>` / `<br>` / `<strong>` を含めて、表示側で v-html や `<Mfm>` で描画するパターンが多用されている。

```yaml
# locales/ja-JP.yml
poweredByMisskeyDescription: "{name}は、オープンソースのプラットフォーム<b>Misskey</b>のサーバーのひとつです。"

# locales/ja-JP.yml (改行 + br)
driveAboutTip: "ドライブでは、過去に...<br>\nノートに添付する際に再利用したり...<br>\n<b>ファイルを削除すると...</b><br>\n..."
```

参照側:
```vue
<div v-html="i18n.tsx.poweredByMisskeyDescription({ name: 'Misskey' })" />
```

注意:

- HTML を含むキー値は **必ずダブルクォート** で囲む (YAML パース失敗回避)
- `v-html` 越しの XSS リスクが無いことを必ず確認する。パラメータ側にユーザー入力をそのまま渡すと事故る。安全な静的文字列か、別途エスケープ済の値だけにする

### リアクティブ参照 + 動的キー切替

時間経過などで翻訳キー自体を切り替えたい場合の慣習。`computed` でラップし、ブラケット記法で翻訳キーを動的に選ぶ。

出典: [packages/frontend/src/components/MkPoll.vue](../../../../../packages/frontend/src/components/MkPoll.vue) の `_poll` 動的キー

```ts
const timer = computed(() => i18n.tsx._poll[
  remaining.value >= 86400 ? 'remainingDays' :
  remaining.value >= 3600 ? 'remainingHours' :
  remaining.value >= 60  ? 'remainingMinutes' : 'remainingSeconds'
]({
  s: Math.floor(remaining.value % 60),
  m: Math.floor(remaining.value / 60) % 60,
  h: Math.floor(remaining.value / 3600) % 24,
  d: Math.floor(remaining.value / 86400),
}));
```

対応する yml (各キーで実際に使うプレースホルダは違って良い):

```yaml
_poll:
  remainingDays: "終了まであと{d}日{h}時間"      # {d} {h}
  remainingHours: "終了まであと{h}時間{m}分"     # {h} {m}
  remainingMinutes: "終了まであと{m}分{s}秒"     # {m} {s}
  remainingSeconds: "終了まであと{s}秒"          # {s}
```

ポイント:

- 各キーで使うプレースホルダは **バラバラで構わない**
- **呼び出し側で候補キー全体に必要な全パラメータの superset を 1 つの引数オブジェクトで渡す**。各キーの内部実装は受け取ったオブジェクトから自分が必要なものだけ拾う

### 識別子として無効なキー名 (ブラケット記法)

キー名が数字始まりや予約語の場合、ドット記法ではアクセスできずブラケット記法を使う。

出典: [packages/frontend/src/components/MkSignin.totp.vue](../../../../../packages/frontend/src/components/MkSignin.totp.vue)

```vue
<div :class="$style.totpDescription">{{ i18n.ts['2fa'] }}</div>
```

新規キー追加時は **lowerCamelCase を守れば不要**。

### ネスト + パラメータ複合

```vue
{{ i18n.tsx._uploader.maxFileSizeIsX({ x: maxSize + 'MB' }) }}
{{ i18n.tsx._auth.shareAccess({ name: appName }) }}
```

### `tsx` の引数に `ts` を埋め込む

別の翻訳済み文字列をパラメータとして渡せる。

出典: [packages/frontend/src/components/MkSignupDialog.rules.vue](../../../../../packages/frontend/src/components/MkSignupDialog.rules.vue)

```ts
i18n.tsx.iHaveReadXCarefullyAndAgree({ x: i18n.ts.serverRules })
```

### 三項演算子で ts / tsx を切り替え

パラメータ有無で出し分け。

```vue
{{ name ? i18n.tsx._auth.shareAccess({ name }) : i18n.ts._auth.shareAccessAsk }}
```

## 他言語ファイルの扱い (Crowdin と MISTEMS)

### 同期メカニズム (上流)

[crowdin.yml](../../../../../crowdin.yml):
```yaml
files:
  - source: /locales/ja-JP.yml
    translation: /locales/%locale%.yml
    update_option: update_as_unapproved
```

- `ja-JP.yml` = **source**。これだけが翻訳元
- `en-US.yml` / `fr-FR.yml` ほか `ja-JP.yml` 以外の全 locale = **translation**。上流 (misskey-dev) では Crowdin が自動 PR で更新する
- 根拠: [locales/README.md](../../../../../locales/README.md) "DO NOT edit locale files except `ja-JP.yml`." (上流向けの規則)

### MISTEMS でのルール

MISTEMS は Crowdin とつながっていない。他言語ファイルのキーは、出どころで扱いを分ける。

| キー | 他言語ファイルでの扱い |
| --- | --- |
| 上流にあるキー (起点の同じファイルにあるキー) | 触らない。上流の Crowdin が更新し、develop 経由で入ってくる。変えると統合のたびにコンフリクトする |
| MISTEMS 独自のキー | 手で書く。`ja-JP.yml` に足したら、`en-US.yml` にも同じキーの訳を足す。ほかの言語は任意 |

判定は `node scripts/check-shipping.mjs` の locale safety が行う。起点の同じファイルにあるキーの変更・削除を違反とし、それ以外のキーの追加・修正は通す。

### キーのリネーム

- **上流にあるキー**はリネームしない。上流では、旧キーの翻訳が孤立して消えないよう「新キー追加 → Crowdin の翻訳を待つ → 旧キー削除」の 3 段階で行うもので、上流の領分である
- **MISTEMS 独自のキー**は、`ja-JP.yml` と `en-US.yml` (ほかに訳を書いた言語も) を同じコミットでリネームしてよい。Crowdin を待つ必要はない

### 上流にあるキーを触ってしまったら

locale safety が `changed upstream key: <key>` / `removed upstream key: <key>` を出したら、そのキーだけを起点の内容に戻す。

`git restore --source=origin/develop -- locales/en-US.yml` のようにファイルごと戻すと、同じファイルに書いた MISTEMS 独自のキーまで消える。ファイルごと戻すのは、そのファイルに MISTEMS 独自のキーが無いときだけにする。

## トラブルシュート

i18n 周辺で踏みやすい失敗とその対処。エラー文字列で grep してたどり着けるよう整理。

### 型エラー: `Property '<key>' does not exist on type 'Locale'`

**症状**:
```
packages/frontend/src/components/MkXxx.vue
> i18n.ts.newKey
  Property 'newKey' does not exist on type 'Locale'.
```

**原因**: ja-JP.yml にキーは追加したが、`packages/i18n` の型生成 (`autogen/locale.ts`) が再生成されていない。

**対処**:

- `pnpm dev` を起動中なら、`packages/i18n` の watch (`nodemon ... tsx ./build.ts --watch`) が自動再生成するので、yml 保存後に typecheck をやり直す
- 一回だけ手動再生成したいなら: `pnpm --filter i18n generate` (実体は `tsx scripts/generateLocaleInterface.ts`)
- 検出経路: `pnpm --filter frontend lint`

実装根拠: [packages/i18n/scripts/generateLocaleInterface.ts](../../../../../packages/i18n/scripts/generateLocaleInterface.ts) (パラメータ抽出の正規表現 `/\{(\w+)\}/g`)。

### 型エラー: ts/tsx の取り違え

**症状 A** (パラメータ無しキーを tsx で呼ぶ):
```
i18n.tsx.save({...})
> Property 'save' does not exist on type 'Tsx<Locale>'.
```

**症状 B** (パラメータ付きキーを ts で参照、関数化されたまま使う):
```vue
{{ i18n.ts.unfollowConfirm }}
<!-- 画面に "{name}のフォローを解除しますか？" が {name} 未置換のまま出る -->
```

**原因**: `Tsx<T>` 型 ([packages/frontend-shared/js/i18n.ts](../../../../../packages/frontend-shared/js/i18n.ts)) は `ParameterizedString<P>` を持つキーだけを関数として公開する。

**対処**: パラメータ有無は yml の `{...}` 記法で決まる。

| yml の値 | ts | tsx |
|---|---|---|
| `"保存"` | `i18n.ts.save` ✅ | (キー存在せず) ❌ |
| `"{name}のフォローを解除しますか？"` | `i18n.ts.unfollowConfirm` → `{name}` 未置換の文字列のまま ❌ | `i18n.tsx.unfollowConfirm({ name })` ✅ |

### 実行時警告: `Unexpected locale key: <key>`

**症状**: 開発モードのコンソールに出る。

**原因**: dev mode の Proxy が ja-JP.yml に存在しないキーへのアクセスを検知 ([packages/frontend-shared/js/i18n.ts](../../../../../packages/frontend-shared/js/i18n.ts) の dev 用 Proxy)。

**対処**: ja-JP.yml に該当キーを追加するか、参照側のタイポを直す。

### 実行時警告: `Missing locale parameters: <param> at <key>`

**症状**: dev mode コンソール。

**原因**:

- yml 側 `{name}` に対し、呼び出し側で `{ user: ... }` のように **キー名が違う**
- あるいは引数オブジェクトに値が含まれていない

実装根拠: [packages/frontend-shared/js/i18n.ts](../../../../../packages/frontend-shared/js/i18n.ts) (`Object.hasOwn(arg, expressions[i])` チェック)。

**対処**: yml と呼び出し側でパラメータ名を一致させる。yml 側のキー名を変更したら、呼び出し側 (frontend 全体) を grep で揃える。

### YAML パース失敗

**症状**: `pnpm --filter i18n generate` 実行時に `YAMLException: ...`、または `pnpm dev` の watch ログにエラー。

**原因**: 値に YAML の特殊文字 (`<` `>` `:` `'` `&` `*` `|` `>` `#`) を含むのに **クォートしていない**。

**対処**: 値全体を `"..."` (ダブルクォート) で囲む。

```yaml
# OK: HTML タグを含む
poweredByMisskeyDescription: "{name}は、...プラットフォーム<b>Misskey</b>のサーバーのひとつです。"

# OK: コロン・シングルクォート・角括弧を含む URL 説明
objectStorageBaseUrlDesc: "参照に使用するURL。CDNやProxyを使用している場合はそのURL、S3: 'https://<bucket>.s3.amazonaws.com'、GCS等: 'https://storage.googleapis.com/<bucket>'。"

# OK: 改行をリテラルで埋め込む
driveAboutTip: "ドライブでは、過去にアップロードしたファイルの...<br>\nノートに添付する際に..."
```

YAML の block scalar (`|` / `>`) も使えるが、HTML タグ + プレースホルダ混在では **ダブルクォート + `\n` エスケープ** の方が安定する。

### キー名衝突: `_lang_` を上書きしてしまう

**症状**: 各言語ファイルの先頭にある `_lang_` (例: ja-JP は `"日本語"`) を別用途で使おうとして上書き。

**原因**: `_lang_` は **言語自身の表記** に予約されている ([packages/i18n/src/autogen/locale.ts](../../../../../packages/i18n/src/autogen/locale.ts) の先頭キー)。

**対処**: 新規キーは別名にする。

### frontend で diff を当てても変わらない

**症状**: ja-JP.yml を変更したが画面に反映されない。

**原因**:

- `pnpm dev` ではなく `pnpm --filter frontend watch` だけ起動していて、`packages/i18n` の watch が走っていない
- もしくは frontend へ配信される生成物 (`built/_frontend_dist_/locales/*.json`) がブラウザ側でキャッシュされている

**対処**: ルートの `pnpm dev` を起動する (frontend + backend + i18n watch が全部立ち上がる)。それでも反映しないならブラウザのキャッシュをクリア、または `pnpm --filter i18n build` を手動実行。

## 制約と補足

### ICU MessageFormat 非対応

[packages/i18n/scripts/generateLocaleInterface.ts](../../../../../packages/i18n/scripts/generateLocaleInterface.ts) の正規表現は `/\{(\w+)\}/g`。つまり受け付けるのは **`{paramName}` 形式の単純置換のみ**。

```yaml
# NG: ICU plural — そのまま画面に文字列として出るだけ
items: "{count, plural, one {1個} other {{count}個}}"

# NG: ICU select
gender: "{gender, select, male {彼} female {彼女} other {その人}}"
```

代替戦略:

#### 1. 件数別にキーを分ける

```yaml
# OK
withNFiles: "{n}個のファイル"
withOneFile: "1個のファイル"
```

```ts
const text = files.length === 1
  ? i18n.ts.withOneFile
  : i18n.tsx.withNFiles({ n: files.length });
```

#### 2. 切替パターン (動的キー)

時間経過のような連続的な分岐は MkPoll のパターン ([上記「リアクティブ参照」](#リアクティブ参照--動的キー切替)) を採用。

### 予約キー `_lang_`

各 yml ファイルの **トップレベル先頭** に置かれ、その言語自身の表記名を持つ。

```yaml
# locales/ja-JP.yml (トップレベル先頭)
_lang_: "日本語"
```

UI の言語切替プルダウンなどで参照される。**新規キーには使わない**。

### Storybook での挙動

Storybook 環境はバンドラが別物なので、本番の i18n パッケージをそのままは使わない。代わりに [packages/frontend/.storybook/preload-locale.ts](../../../../../packages/frontend/.storybook/preload-locale.ts) がビルド時に **ja-JP の locale だけを JSON にダンプして同居 `locale.ts` を生成** する。

つまり Storybook では:

- **ja-JP の文字列だけが見える** (他言語の検証はできない)
- ja-JP.yml にキーを追加した直後に Storybook を起動しても、`preload-locale.ts` 実行前なら反映されない。Storybook を再起動するか、`packages/i18n` を一度 build する
- stories からの呼び方は通常通り: `i18n.tsx._dialog.charactersBelow({ current: 0, min: 2 })`

### backend での i18n 直接参照は基本無し

i18n は frontend (および一部の SSR されるエラーページ) でのみ使われる。`packages/backend` 配下から `import { i18n }` するパターンは原則無く、API エラー文言は別ルート (`ApiError` の i18n 化されていないメッセージ + frontend 側で翻訳) で扱う。

### 改行の扱い

ダブルクォート値の中で `\n` は実際の改行になる。block scalar (`|`) でも可だが、HTML タグやプレースホルダ混在では扱いづらい。慣習はダブルクォート + `\n`。

Vue 側で表示時に `white-space: pre-wrap` などを当てる必要あり。
