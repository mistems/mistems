/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';

/**
 * ノートの表示内容を取得する
 * リノートの場合は元のノートを返し、それ以外は渡されたノートをそのまま返す
 * ジェネリック型を使用して、入力の型情報（FusionNoteなど）を保持する
 */
export function getAppearNote<T extends Misskey.entities.Note>(note: T): T {
	return (Misskey.note.isPureRenote(note) ? note.renote : note) as T;
}
