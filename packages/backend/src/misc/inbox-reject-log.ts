/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { IncomingHttpHeaders } from 'node:http';

type HeaderValue = string | string[] | undefined;

function first(value: HeaderValue): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function quote(value: string | undefined, maxLength = 200): string {
	if (value == null) return '-';
	const truncated = value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
	return JSON.stringify(truncated);
}

/**
 * Signature ヘッダーなどから keyId を取り出す。
 * draft-cavage の `keyId="..."` と、RFC 9421 の Signature-Input の `keyid="..."` の両方を見る。
 */
export function extractKeyId(headers: IncomingHttpHeaders): string | undefined {
	const candidates = [first(headers['signature']), first(headers['authorization']), first(headers['signature-input'])];
	for (const value of candidates) {
		if (value == null) continue;
		const match = value.match(/keyid="([^"]*)"/i);
		if (match) return match[1];
	}
	return undefined;
}

function hostOf(url: string | undefined): string | undefined {
	if (url == null) return undefined;
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

/**
 * inbox が 401 を返したときに、送り元が付けてきた署名まわりのヘッダーを 1 行に要約する。
 * 署名の値そのものは出さず、有無と、どのヘッダーを署名したかだけを書く。
 */
export function describeInboxSignatureHeaders(headers: IncomingHttpHeaders, actor?: unknown): {
	host: string;
	summary: string;
} {
	const signature = first(headers['signature']);
	const signatureInput = first(headers['signature-input']);
	const authorization = first(headers['authorization']);
	const keyId = extractKeyId(headers);
	const host = hostOf(keyId) ?? hostOf(typeof actor === 'string' ? actor : undefined) ?? 'unknown';

	// draft-cavage の headers="..." か、RFC 9421 の Signature-Input の (...) を、署名した項目の一覧として出す
	const signedHeaders = signature?.match(/headers="([^"]*)"/i)?.[1]
		?? authorization?.match(/headers="([^"]*)"/i)?.[1]
		?? signatureInput?.match(/=\(([^)]*)\)/)?.[1];
	const algorithm = signature?.match(/algorithm="([^"]*)"/i)?.[1]
		?? authorization?.match(/algorithm="([^"]*)"/i)?.[1]
		?? signatureInput?.match(/alg="([^"]*)"/i)?.[1];

	const summary = [
		`ua=${quote(first(headers['user-agent']))}`,
		`signature=${signature == null ? 'no' : /keyid=/i.test(signature) ? 'cavage' : 'other'}`,
		`signatureInput=${signatureInput == null ? 'no' : 'yes'}`,
		`authorization=${authorization == null ? 'no' : (authorization.split(' ')[0] ?? 'yes')}`,
		`keyId=${quote(keyId)}`,
		`algorithm=${quote(algorithm, 50)}`,
		`signedHeaders=${quote(signedHeaders)}`,
		`digest=${headers['digest'] == null ? 'no' : quote(first(headers['digest'])?.split('=')[0], 20)}`,
		`contentDigest=${headers['content-digest'] == null ? 'no' : quote(first(headers['content-digest'])?.split('=')[0], 20)}`,
		`date=${quote(first(headers['date']), 50)}`,
		`requestHost=${quote(first(headers['host']), 100)}`,
	].join(' ');

	return { host, summary };
}

/**
 * 同じ送り元・同じ理由の 401 のログを、一定時間に 1 回に間引く。
 * 間引いた件数は、次に出すときに添える。
 */
export class InboxRejectLogThrottle {
	private entries = new Map<string, { lastLoggedAt: number; suppressed: number }>();

	constructor(
		private readonly intervalMs: number,
		private readonly maxEntries = 1000,
		private readonly now: () => number = Date.now,
	) {}

	/**
	 * 出してよいときは、前回から間引いた件数を返す。間引くときは null を返す。
	 */
	public check(host: string, reason: string): number | null {
		const key = `${host}\n${reason}`;
		const now = this.now();
		const entry = this.entries.get(key);

		if (entry != null && now - entry.lastLoggedAt < this.intervalMs) {
			entry.suppressed++;
			return null;
		}

		if (entry == null && this.entries.size >= this.maxEntries) {
			// 送り元が多すぎるときは古い記録を捨てる (メモリを使い続けないため)
			this.entries.clear();
		}

		const suppressed = entry?.suppressed ?? 0;
		this.entries.set(key, { lastLoggedAt: now, suppressed: 0 });
		return suppressed;
	}
}
