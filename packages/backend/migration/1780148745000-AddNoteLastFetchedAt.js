/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddNoteLastFetchedAt1780148745000 {
    name = 'AddNoteLastFetchedAt1780148745000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note" ADD "lastFetchedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "note" ADD "refetchedCount" smallint NOT NULL DEFAULT '0'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "refetchedCount"`);
        await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "lastFetchedAt"`);
    }
}
