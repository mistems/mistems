/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';

/**
 * タイムマシン/タイムシフトがアクティブかどうか（タイムフュージョンを除く）
 * UIモードがデフォルトの場合、この状態では投稿を制限する
 */
export const isTimemachineActive = ref(false);
