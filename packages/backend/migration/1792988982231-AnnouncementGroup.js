/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AnnouncementGroup1792988982231 {
    name = 'AnnouncementGroup1792988982231'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "announcement_group" ("id" character varying(32) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(256) NOT NULL, "icon" character varying(128), "order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_0b316cfe145d21efc5fd71122d7" PRIMARY KEY ("id")); COMMENT ON COLUMN "announcement_group"."updatedAt" IS 'The updated date of the AnnouncementGroup.'`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "mutedAnnouncementGroupIds" character varying(32) array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`COMMENT ON COLUMN "user_profile"."mutedAnnouncementGroupIds" IS 'List of announcement group IDs muted by the user. ''ungrouped'' means announcements without group.'`);
        await queryRunner.query(`ALTER TABLE "announcement" ADD "groupId" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "announcement" ADD "displayOrder" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX "IDX_25e7b2f48d469cf31eb8adf8b6" ON "announcement"  ("groupId") `);
        await queryRunner.query(`ALTER TABLE "announcement" ADD CONSTRAINT "FK_25e7b2f48d469cf31eb8adf8b6c" FOREIGN KEY ("groupId") REFERENCES "announcement_group"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "announcement" DROP CONSTRAINT "FK_25e7b2f48d469cf31eb8adf8b6c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_25e7b2f48d469cf31eb8adf8b6"`);
        await queryRunner.query(`ALTER TABLE "announcement" DROP COLUMN "displayOrder"`);
        await queryRunner.query(`ALTER TABLE "announcement" DROP COLUMN "groupId"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "mutedAnnouncementGroupIds"`);
        await queryRunner.query(`DROP TABLE "announcement_group"`);
    }
}
