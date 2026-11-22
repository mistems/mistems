/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { describeInboxSignatureHeaders, extractKeyId, InboxRejectLogThrottle } from '@/misc/inbox-reject-log.js';

describe('inbox-reject-log', () => {
	describe('extractKeyId', () => {
		test('draft-cavage の Signature から取り出す', () => {
			expect(extractKeyId({ signature: 'keyId="https://example.com/users/a#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="xxx"' }))
				.toBe('https://example.com/users/a#main-key');
		});

		test('RFC 9421 の Signature-Input から取り出す', () => {
			expect(extractKeyId({
				'signature-input': 'sig1=("@method" "@target-uri" "content-digest");created=1700000000;keyid="https://threads.example/ap/users/1/#main-key"',
				signature: 'sig1=:AAAA:',
			})).toBe('https://threads.example/ap/users/1/#main-key');
		});

		test('どこにもなければ undefined', () => {
			expect(extractKeyId({})).toBeUndefined();
		});
	});

	describe('describeInboxSignatureHeaders', () => {
		test('draft-cavage の要求を要約し、署名の値は出さない', () => {
			const { host, summary } = describeInboxSignatureHeaders({
				'user-agent': 'facebookexternalua',
				signature: 'keyId="https://example.com/users/a#main-key",algorithm="hs2019",headers="(request-target) host date digest",signature="SECRETVALUE"',
				digest: 'SHA-256=abc',
				date: 'Thu, 12 Nov 2026 00:00:00 GMT',
				host: 'gamelore.example',
			});
			expect(host).toBe('example.com');
			expect(summary).toContain('ua="facebookexternalua"');
			expect(summary).toContain('signature=cavage');
			expect(summary).toContain('signatureInput=no');
			expect(summary).toContain('algorithm="hs2019"');
			expect(summary).toContain('signedHeaders="(request-target) host date digest"');
			expect(summary).toContain('digest="SHA-256"');
			expect(summary).toContain('contentDigest=no');
			expect(summary).not.toContain('SECRETVALUE');
			expect(summary).not.toContain('abc');
		});

		test('RFC 9421 の要求を要約する', () => {
			const { host, summary } = describeInboxSignatureHeaders({
				'signature-input': 'sig1=("@method" "@target-uri" "content-digest");created=1700000000;keyid="https://threads.example/ap/users/1/#main-key";alg="rsa-v1_5-sha256"',
				signature: 'sig1=:SECRETVALUE:',
				'content-digest': 'sha-256=:abc:',
			});
			expect(host).toBe('threads.example');
			expect(summary).toContain('signature=other');
			expect(summary).toContain('signatureInput=yes');
			expect(summary).toContain('signedHeaders="\\"@method\\" \\"@target-uri\\" \\"content-digest\\""');
			expect(summary).toContain('algorithm="rsa-v1_5-sha256"');
			expect(summary).toContain('digest=no');
			expect(summary).toContain('contentDigest="sha-256"');
			expect(summary).not.toContain('SECRETVALUE');
		});

		test('keyId がなければ actor のホストを使う', () => {
			expect(describeInboxSignatureHeaders({}, 'https://actor.example/users/1').host).toBe('actor.example');
			expect(describeInboxSignatureHeaders({}).host).toBe('unknown');
		});
	});

	describe('InboxRejectLogThrottle', () => {
		test('同じ送り元・同じ理由は間隔内に 1 回だけ出し、次に出すときに間引いた件数を返す', () => {
			let now = 0;
			const throttle = new InboxRejectLogThrottle(1000, 1000, () => now);
			expect(throttle.check('a.example', 'r')).toBe(0);
			expect(throttle.check('a.example', 'r')).toBeNull();
			expect(throttle.check('a.example', 'r')).toBeNull();
			// 送り元か理由が違えば別に出す
			expect(throttle.check('b.example', 'r')).toBe(0);
			expect(throttle.check('a.example', 'other')).toBe(0);
			now = 1000;
			expect(throttle.check('a.example', 'r')).toBe(2);
			expect(throttle.check('a.example', 'r')).toBeNull();
		});

		test('記録が上限を超えたら捨てる', () => {
			const throttle = new InboxRejectLogThrottle(1000, 2, () => 0);
			expect(throttle.check('a', 'r')).toBe(0);
			expect(throttle.check('b', 'r')).toBe(0);
			expect(throttle.check('c', 'r')).toBe(0);
			// 捨てたので a はまた出せる
			expect(throttle.check('a', 'r')).toBe(0);
		});
	});
});
