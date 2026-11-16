/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MISTEMS の統合 (main-統合.sh の最後) で実行する、MISTEMS 独自の lint。
// 開発と本番ビルドで挙動が変わるなど、通常の lint では見つからない落とし穴を検出する。
// 型情報を使わない軽いルールだけを置き、frontend 全体を数秒で検査できるようにする。
// 実行: node scripts/mistems-lint.mjs (違反があれば、直すべきブランチの探し方も表示する)

import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import pluginVue from 'eslint-plugin-vue';

// rollup-plugin-unwind-css-module-class-name (本番ビルドのみ) は、テンプレートの `$style.<key>` をクラス名の文字列に置き換えたうえで、
// コンポーネントから __cssModules を外す。そのため `$style.<key>` / `$style[<key>]` 以外の形で CSS モジュールを参照すると、
// 開発サーバーでは動くのに本番では undefined になる (2026-11 にタイムラインのアニメーションが本番だけ止まった)
const CSS_MODULE_REASON = '本番ビルドでは rollup-plugin-unwind-css-module-class-name が __cssModules を外すため、開発サーバーでは動いても本番では undefined になる。クラス名はテンプレートで $style.<key> (または $style[<key>]) として参照すること (例: :enterActiveClass="cond ? undefined : $style.foo")';

export default [
	{
		files: ['src/**/*.{ts,vue}'],
		ignores: ['**/*.stories.ts', '**/*.stories.impl.ts'],
		linterOptions: {
			// 通常の lint 用の eslint-disable コメントは、ここで読み込んでいないプラグインのルールを指していて
			// 「ルールが見つからない」エラーになるので、インラインの設定はすべて無視する (このルールは eslint-disable で黙らせない)
			noInlineConfig: true,
			reportUnusedDisableDirectives: 'off',
		},
		plugins: {
			vue: pluginVue,
		},
		languageOptions: {
			parser: vueParser,
			parserOptions: {
				parser: tsParser,
				extraFileExtensions: ['.vue'],
				sourceType: 'module',
			},
		},
		rules: {
			'no-restricted-imports': ['error', {
				paths: [{
					name: 'vue',
					importNames: ['useCssModule'],
					message: `useCssModule() は使わない。${CSS_MODULE_REASON}`,
				}],
			}],
			'no-restricted-syntax': ['error', {
				// this.$style / getCurrentInstance().proxy.$style など
				selector: 'MemberExpression[property.name=\'$style\']',
				message: `script から $style を参照しない。${CSS_MODULE_REASON}`,
			}],
			'vue/no-restricted-syntax': ['error', {
				// テンプレートで $style をまるごと渡す (:styles="$style" など)
				selector: 'Identifier[name=\'$style\']:not(MemberExpression > Identifier.object)',
				message: `$style をまるごと参照しない。${CSS_MODULE_REASON}`,
			}],
		},
	},
];
