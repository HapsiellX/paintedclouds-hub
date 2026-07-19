import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTorrentFallbackState1785004000000 implements MigrationInterface {
  name = 'AddTorrentFallbackState1785004000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" ADD "torrentFallbackAttemptedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" ADD "torrentFallbackStatus" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" ADD "torrentFallbackCountry" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" DROP COLUMN "torrentFallbackCountry"`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" DROP COLUMN "torrentFallbackStatus"`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_acquisition_issue" DROP COLUMN "torrentFallbackAttemptedAt"`
    );
  }
}
