/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from 'node:path';
import { promises as fsp } from 'node:fs';
import { languages } from 'i18n/const';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { htmlSafeJsonStringify } from '@/misc/json-stringify-html-safe.js';
import { MetaEntityService } from '@/core/entities/MetaEntityService.js';
import type { FastifyReply } from 'fastify';
import type { Manifest } from 'vite';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import type { CommonData, ViteFiles } from './views/_.js';
import { ClientLoggerService } from './ClientLoggerService.js';
import { listVariants, pickVariant } from './frontend-variant.js';

type FrontendAssets = {
	viteFiles: ViteFiles | null;
	bootloaderJs: string | null;
	bootloaderCss: string | null;
};

@Injectable()
export class HtmlTemplateService {
	private frontendAssetsPromise: Promise<void> | null = null;
	private readonly frontendViteBuilt: string;
	private readonly frontendEmbedViteBuilt: string;
	public frontendViteFiles: ViteFiles | null = null;
	public frontendBootloaderJs: string | null = null;
	public frontendBootloaderCss: string | null = null;
	public frontendEmbedViteFiles: ViteFiles | null = null;
	public frontendEmbedBootloaderJs: string | null = null;
	public frontendEmbedBootloaderCss: string | null = null;
	public readonly frontendVariantsRoot: string;
	private readonly variantAssets = new Map<string, FrontendAssets>();

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private metaEntityService: MetaEntityService,

		private clientLoggerService: ClientLoggerService,
	) {
		this.frontendViteBuilt = resolve(this.config.rootDir, 'built/_frontend_vite_');
		this.frontendEmbedViteBuilt = resolve(this.config.rootDir, 'built/_frontend_embed_vite_');
		this.frontendVariantsRoot = resolve(this.config.rootDir, 'frontend-variants');
	}

	// 初期ロードで読み込むべきファイルのパスを収集する。
	// See https://ja.vite.dev/guide/backend-integration
	@bindThis
	private collectViteAssetFiles(manifest: Manifest): ViteFiles {
		const entryFile = Object.values(manifest).find((chunk) => chunk.isEntry);
		if (!entryFile) return {
			entryJs: null,
			css: [],
			modulePreloads: [],
		};

		const seenChunkIds = new Set<string>();
		const cssFiles = new Set<string>();
		const modulePreloads = new Set<string>();

		if (entryFile.css) {
			entryFile.css.forEach((css) => cssFiles.add(css));
		}

		if (entryFile.imports != null && Array.isArray(entryFile.imports)) {
			function collectImports(imports: string[], recursive = false) {
				for (const importId of imports) {
					if (seenChunkIds.has(importId)) continue;
					seenChunkIds.add(importId);

					const importedChunk = manifest[importId];
					if (!importedChunk) return;

					if (importedChunk.css) {
						importedChunk.css.forEach((css) => cssFiles.add(css));
					}

					if (importedChunk.imports != null && Array.isArray(importedChunk.imports)) {
						collectImports(importedChunk.imports, true);
					}

					if (!recursive) {
						modulePreloads.add(importedChunk.file);
					}
				}
			}

			collectImports(entryFile.imports);
		}

		return {
			entryJs: entryFile.file,
			css: Array.from(cssFiles),
			modulePreloads: Array.from(modulePreloads),
		};
	}

	@bindThis
	private async loadVariantAssets(dir: string): Promise<FrontendAssets> {
		const [bootloaderJs, bootloaderCss, manifestContent] = await Promise.all([
			fsp.readFile(resolve(dir, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(dir, 'loader/style.css'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(dir, 'manifest.json'), 'utf-8').catch(() => null),
		]);
		if (manifestContent == null) throw new Error(`manifest.json not found in ${dir}`);
		const manifest = JSON.parse(manifestContent) as Manifest;
		return {
			viteFiles: this.collectViteAssetFiles(manifest),
			bootloaderJs,
			bootloaderCss,
		};
	}

	@bindThis
	private async prepareFrontendAssets() {
		// 同時に呼ばれても読み込みは一度だけ行い、失敗したら次の呼び出しで再試行する
		if (this.frontendAssetsPromise == null) {
			this.frontendAssetsPromise = this.loadFrontendAssets().catch(err => {
				this.frontendAssetsPromise = null;
				throw err;
			});
		}
		await this.frontendAssetsPromise;
	}

	@bindThis
	private async loadFrontendAssets() {
		const [
			bootJs,
			bootCss,
			embedBootJs,
			embedBootCss,
		] = await Promise.all([
			fsp.readFile(resolve(this.frontendViteBuilt, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendViteBuilt, 'loader/style.css'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'loader/style.css'), 'utf-8').catch(() => null),
		]);

		let feViteManifest: Manifest | null = null;
		let embedFeViteManifest: Manifest | null = null;

		if (this.config.frontendManifestExists) {
			const manifestContent = await fsp.readFile(resolve(this.frontendViteBuilt, 'manifest.json'), 'utf-8').catch(() => null);
			feViteManifest = manifestContent ? JSON.parse(manifestContent) : null;
		}

		if (this.config.frontendEmbedManifestExists) {
			const manifestContent = await fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'manifest.json'), 'utf-8').catch(() => null);
			embedFeViteManifest = manifestContent ? JSON.parse(manifestContent) : null;
		}

		if (feViteManifest != null) {
			this.frontendViteFiles = this.collectViteAssetFiles(feViteManifest);
		}

		if (bootJs != null) {
			this.frontendBootloaderJs = bootJs;
		}

		if (bootCss != null) {
			this.frontendBootloaderCss = bootCss;
		}

		if (embedFeViteManifest != null) {
			this.frontendEmbedViteFiles = this.collectViteAssetFiles(embedFeViteManifest);
		}

		if (embedBootJs != null) {
			this.frontendEmbedBootloaderJs = embedBootJs;
		}

		if (embedBootCss != null) {
			this.frontendEmbedBootloaderCss = embedBootCss;
		}

		let variantNames: string[] = [];
		try {
			variantNames = listVariants(this.frontendVariantsRoot);
		} catch (err) {
			this.clientLoggerService.logger.warn(`Failed to list frontend variants: ${err instanceof Error ? err.message : String(err)}`);
		}

		for (const name of variantNames) {
			try {
				this.variantAssets.set(name, await this.loadVariantAssets(resolve(this.frontendVariantsRoot, name)));
			} catch (err) {
				this.clientLoggerService.logger.warn(`Failed to load frontend variant "${name}", skipping: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	@bindThis
	public resolveVariant(cookieHeader: string | undefined): string | null {
		return pickVariant(cookieHeader, [...this.variantAssets.keys()]);
	}

	/** 読み込み済みの variant があるか。読み込みは起こさない。 */
	@bindThis
	public hasVariants(): boolean {
		return this.variantAssets.size > 0;
	}

	@bindThis
	public async getAvailableVariants(): Promise<string[]> {
		await this.prepareFrontendAssets();
		return [...this.variantAssets.keys()];
	}

	@bindThis
	public async getCommonData(cookieHeader: string | undefined): Promise<CommonData> {
		await this.prepareFrontendAssets();

		const variant = this.resolveVariant(cookieHeader);
		const variantAssets = variant != null ? this.variantAssets.get(variant) : undefined;

		return {
			version: this.config.version,
			config: this.config,
			langs: [...languages],
			instanceName: this.meta.name ?? 'Misskey',
			icon: this.meta.iconUrl,
			appleTouchIcon: this.meta.app512IconUrl,
			themeColor: this.meta.themeColor,
			serverErrorImageUrl: this.meta.serverErrorImageUrl ?? 'https://xn--931a.moe/assets/error.jpg',
			infoImageUrl: this.meta.infoImageUrl ?? 'https://xn--931a.moe/assets/info.jpg',
			notFoundImageUrl: this.meta.notFoundImageUrl ?? 'https://xn--931a.moe/assets/not-found.jpg',
			instanceUrl: this.config.url,
			metaJson: htmlSafeJsonStringify(await this.metaEntityService.packDetailed(this.meta)),
			now: Date.now(),
			federationEnabled: this.meta.federation !== 'none',
			frontendViteFiles: variantAssets?.viteFiles ?? this.frontendViteFiles,
			frontendBootloaderJs: variantAssets?.bootloaderJs ?? this.frontendBootloaderJs,
			frontendBootloaderCss: variantAssets?.bootloaderCss ?? this.frontendBootloaderCss,
			frontendEmbedViteFiles: this.frontendEmbedViteFiles,
			frontendEmbedBootloaderJs: this.frontendEmbedBootloaderJs,
			frontendEmbedBootloaderCss: this.frontendEmbedBootloaderCss,
			frontendVariant: variantAssets != null ? variant : null,
		};
	}

	public static async replyHtml(reply: FastifyReply, html: string | Promise<string>) {
		reply.header('Content-Type', 'text/html; charset=utf-8');
		const _html = await html;
		return reply.send(_html);
	}
}
