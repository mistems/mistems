/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * タイムスタンプを指定されたフォーマットで文字列に変換
 */
export function formatTimestamp(timestamp: number, format: 'goto' | 'datetime-local' | 'date' | 'time' | 'time-sec'): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	switch (format) {
		case 'goto':
			// YYYYMMDDHHmmss形式（URLパラメータ用）
			return `${year}${month}${day}${hours}${minutes}${seconds}`;
		case 'datetime-local':
			// YYYY-MM-DDTHH:mm形式（datetime-local input用）
			return `${year}-${month}-${day}T${hours}:${minutes}`;
		case 'date':
			// YYYY-MM-DD形式（date input用）
			return `${year}-${month}-${day}`;
		case 'time':
			// HH:mm形式（time input用）
			return `${hours}:${minutes}`;
		case 'time-sec':
			// YYYY/MM/DD HH:mm:ss形式（表示用）
			return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
	}
}

/**
 * gotoパラメータ（YYYYMMDDHHmmss）を日付・時刻入力に変換
 */
export function parseGotoParam(goto: string): { dateInput: string; timeInput: string } | null {
	if (!/^\d{14}$/.test(goto)) return null;

	const year = goto.substring(0, 4);
	const month = goto.substring(4, 6);
	const day = goto.substring(6, 8);
	const hours = goto.substring(8, 10);
	const minutes = goto.substring(10, 12);

	return {
		dateInput: `${year}-${month}-${day}`,
		timeInput: `${hours}:${minutes}`,
	};
}

/**
 * datetime-local形式の文字列をタイムスタンプに変換
 */
export function parseDatetimeLocal(datetimeLocal: string): number {
	if (!datetimeLocal) return 0;
	const timestamp = new Date(datetimeLocal).getTime();
	if (isNaN(timestamp)) return 0;
	return timestamp;
}

/**
 * 日付と時刻の入力値からタイムスタンプを生成
 */
export function parseDateTime(dateInput: string, timeInput: string): number | null {
	const datetime = new Date(`${dateInput}T${timeInput}`);
	if (isNaN(datetime.getTime())) return null;
	return datetime.getTime();
}
