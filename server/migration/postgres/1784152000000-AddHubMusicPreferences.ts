import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubMusicPreferences1784152000000 implements MigrationInterface {
  name = 'AddHubMusicPreferences1784152000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_user_profile" ADD "musicGenres" text`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_user_profile" ADD "musicArtists" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_user_profile" DROP COLUMN "musicArtists"`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_user_profile" DROP COLUMN "musicGenres"`
    );
  }
}
