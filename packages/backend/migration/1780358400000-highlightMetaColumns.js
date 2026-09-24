/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class HighlightMetaColumns1780358400000 {
    name = 'HighlightMetaColumns1780358400000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "highlightRateFactor" integer NOT NULL DEFAULT 30`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "highlightMidPopularityThreshold" integer NOT NULL DEFAULT 3`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "highlightHighPopularityThreshold" integer NOT NULL DEFAULT 5`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "highlightExcludeEmojis" text NOT NULL DEFAULT ''`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "highlightExcludeEmojis"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "highlightHighPopularityThreshold"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "highlightMidPopularityThreshold"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "highlightRateFactor"`);
    }
}
