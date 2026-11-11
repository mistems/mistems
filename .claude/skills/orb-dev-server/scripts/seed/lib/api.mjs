/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Misskey API の薄いクライアント。依存なし (Node 標準の fetch / FormData / Blob)。
// 失敗時はエンドポイント名と応答本文を含めて throw する。

export function createApi(baseUrl) {
	const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

	async function request(endpoint, init) {
		let res;
		// レート制限 (429) に当たったら、少し待って数回だけやり直す
		for (let attempt = 0; ; attempt++) {
			try {
				res = await fetch(base + 'api/' + endpoint, init);
			} catch (err) {
				throw new Error(`${endpoint}: 接続に失敗しました: ${err.message}`);
			}
			if (res.status !== 429 || attempt >= 5) break;
			const retryAfter = Number(res.headers.get('retry-after'));
			await new Promise((resolve) => setTimeout(resolve, (retryAfter > 0 ? retryAfter : 1) * 1000));
		}
		const text = await res.text();
		if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${text}`);
		if (text === '') return null;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	return {
		// token を渡すと body に i として付ける。signin-flow も api/ 配下にある
		async call(endpoint, body = {}, token) {
			return await request(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(token ? { ...body, i: token } : body),
			});
		},
		async upload(token, name, png) {
			const form = new FormData();
			form.append('i', token);
			form.append('name', name);
			form.append('force', 'true');
			form.append('file', new Blob([png], { type: 'image/png' }), name);
			const file = await request('drive/files/create', { method: 'POST', body: form });
			return { id: file.id, url: file.url };
		},
	};
}
