/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';

export type TimelineDbFallbackCandidateSource = {
	/** note."userId" が一致するか (かつ note."channelId" IS NULL) で候補を集める対象 */
	userIds: string[];
	/** note."channelId" が一致するかで候補を集める対象 */
	channelIds: string[];
};

export type TimelineDbFallbackCandidateQuery = {
	untilId: string | null;
	sinceId: string | null;
	/** 最終的に返す候補件数の上限 (呼び出し元の limit に安全マージンを乗せた値) */
	limit: number;
	/** userIds / channelIds の各要素ごとに LATERAL で取得する件数の上限 */
	perSourceLimit: number;
};

/**
 * ホームタイムラインの DB フォールバック (notes/timeline.ts の getFromDb) で、
 * フォロー数が多いユーザーのクエリが `note` の主キーを新しい順に全走査して
 * フィルタする形になり、キャッシュが温まっていない環境で数秒〜十秒級の
 * レイテンシを引き起こす問題を緩和するための候補抽出サービス。
 *
 * userId / channelId ごとに LATERAL で浅くシークして候補 note.id を集める
 * ことで、フォロー中ユーザーの投稿頻度に依存せず読み込むブロック数を
 * 抑える。visibility / mute / block 等のフィルタはここでは行わない
 * (呼び出し元が候補 id に対して既存のフィルタ済みクエリを再適用し、
 * 正確な結果を確定させる前提)。
 */
@Injectable()
export class TimelineDbFallbackService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
	}

	@bindThis
	public async getCandidateIds(
		source: TimelineDbFallbackCandidateSource,
		query: TimelineDbFallbackCandidateQuery,
	): Promise<string[]> {
		const { userIds, channelIds } = source;
		if (userIds.length === 0 && channelIds.length === 0) return [];

		// untilId のみ: 新しい方から遡る (降順)。sinceId のみ: 古い方から追う (昇順)。
		// 両方指定時は notes/timeline.ts 側の makePaginationQuery と同じく untilId 優先で降順。
		const ascending = query.sinceId != null && query.untilId == null;
		const orderDir = ascending ? 'ASC' : 'DESC';
		const idOperator = ascending ? '>' : '<';
		const boundId = ascending ? query.sinceId : query.untilId;

		const params: unknown[] = [];
		const bindParam = (value: unknown) => {
			params.push(value);
			return `$${params.length}`;
		};

		const parts: string[] = [];

		if (userIds.length > 0) {
			const userIdsParam = bindParam(userIds);
			const boundClause = boundId != null ? `AND note.id ${idOperator} ${bindParam(boundId)}` : '';
			const perSourceLimitParam = bindParam(query.perSourceLimit);
			parts.push(`
				SELECT n.id FROM unnest(${userIdsParam}::varchar[]) AS f(uid)
				CROSS JOIN LATERAL (
					SELECT note.id FROM note
					WHERE note."userId" = f.uid AND note."channelId" IS NULL ${boundClause}
					ORDER BY note.id ${orderDir}
					LIMIT ${perSourceLimitParam}
				) n
			`);
		}

		if (channelIds.length > 0) {
			const channelIdsParam = bindParam(channelIds);
			const boundClause = boundId != null ? `AND note.id ${idOperator} ${bindParam(boundId)}` : '';
			const perSourceLimitParam = bindParam(query.perSourceLimit);
			parts.push(`
				SELECT n.id FROM unnest(${channelIdsParam}::varchar[]) AS f(cid)
				CROSS JOIN LATERAL (
					SELECT note.id FROM note
					WHERE note."channelId" = f.cid ${boundClause}
					ORDER BY note.id ${orderDir}
					LIMIT ${perSourceLimitParam}
				) n
			`);
		}

		const finalLimitParam = bindParam(query.limit);
		const sql = `
			SELECT DISTINCT id FROM (
				${parts.join(' UNION ALL ')}
			) candidates
			ORDER BY id ${orderDir}
			LIMIT ${finalLimitParam}
		`;

		const rows = await this.db.query(sql, params) as { id: string }[];
		return rows.map(r => r.id);
	}
}
