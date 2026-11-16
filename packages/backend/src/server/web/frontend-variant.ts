/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FRONTEND_VARIANT_COOKIE = 'mk_fe_variant';

const VARIANT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function isValidVariantName(name: string): boolean {
	return VARIANT_NAME_RE.test(name);
}

export function parseVariantCookie(cookieHeader: string | undefined): string | null {
	if (cookieHeader == null) return null;
	for (const part of cookieHeader.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== FRONTEND_VARIANT_COOKIE) continue;
		const value = part.slice(eq + 1).trim();
		return isValidVariantName(value) ? value : null;
	}
	return null;
}

export function pickVariant(cookieHeader: string | undefined, available: readonly string[]): string | null {
	const name = parseVariantCookie(cookieHeader);
	return name != null && available.includes(name) ? name : null;
}

export function listVariants(variantsRoot: string): string[] {
	if (!existsSync(variantsRoot)) return [];
	return readdirSync(variantsRoot, { withFileTypes: true })
		.filter(d => d.isDirectory() && isValidVariantName(d.name))
		.filter(d => existsSync(join(variantsRoot, d.name, 'manifest.json')))
		.map(d => d.name)
		.sort();
}

export function buildVariantCookie(name: string | null, secure: boolean): string {
	const attrs = [
		`${FRONTEND_VARIANT_COOKIE}=${name ?? ''}`,
		'Path=/',
		`Max-Age=${name != null ? COOKIE_MAX_AGE_SEC : 0}`,
		'SameSite=Lax',
	];
	if (secure) attrs.push('Secure');
	return attrs.join('; ');
}

export type SkippedVariant = {
	name: string;
	branch: string;
	reason: string;
};

function isSkippedVariant(x: unknown): x is SkippedVariant {
	if (typeof x !== 'object' || x == null) return false;
	const o = x as Record<string, unknown>;
	return typeof o.name === 'string' && typeof o.branch === 'string' && typeof o.reason === 'string';
}

export type VariantEntry = {
	name: string;
	branch: string;
	mode: 'merge' | 'as-is';
};

export type VariantIndex = {
	variants: VariantEntry[];
	skipped: SkippedVariant[];
};

function isVariantEntry(x: unknown): x is VariantEntry {
	if (typeof x !== 'object' || x == null) return false;
	const o = x as Record<string, unknown>;
	return typeof o.name === 'string' && typeof o.branch === 'string' && (o.mode === 'merge' || o.mode === 'as-is');
}

// ビルドスクリプトが書き出す _variants.json を読む。ない・壊れている場合は空として扱う
export function readVariantIndex(variantsRoot: string): VariantIndex {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(join(variantsRoot, '_variants.json'), 'utf-8'));
	} catch {
		return { variants: [], skipped: [] };
	}
	if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return { variants: [], skipped: [] };
	const o = parsed as Record<string, unknown>;
	return {
		variants: Array.isArray(o.variants)
			? o.variants.filter(isVariantEntry).map(({ name, branch, mode }) => ({ name, branch, mode }))
			: [],
		skipped: Array.isArray(o.skipped)
			? o.skipped.filter(isSkippedVariant).map(({ name, branch, reason }) => ({ name, branch, reason }))
			: [],
	};
}
