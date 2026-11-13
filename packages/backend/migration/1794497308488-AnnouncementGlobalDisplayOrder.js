/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * お知らせの表示順 (displayOrder) を、グループごとの順番から、お知らせ全体で 1 つの順番に振り直す。
 * グループの中の順番は変えない (displayOrder の小さい順、同じなら新しい順に、全体で 0 から番号を振る)。
 * 特定の利用者向けのお知らせ (userId があるもの) は並べ替えの対象外なので触らない。
 */
export class AnnouncementGlobalDisplayOrder1794497308488 {
    name = 'AnnouncementGlobalDisplayOrder1794497308488'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "announcement" AS a SET "displayOrder" = o.rn FROM (SELECT "id", (ROW_NUMBER() OVER (ORDER BY "displayOrder" ASC, "id" DESC) - 1)::integer AS rn FROM "announcement" WHERE "userId" IS NULL) AS o WHERE a."id" = o."id"`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // グループごとに 0 から振り直す (グループの中の順番は変わらない)
        await queryRunner.query(`UPDATE "announcement" AS a SET "displayOrder" = o.rn FROM (SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "groupId" ORDER BY "displayOrder" ASC, "id" DESC) - 1)::integer AS rn FROM "announcement" WHERE "userId" IS NULL) AS o WHERE a."id" = o."id"`);
    }
}
