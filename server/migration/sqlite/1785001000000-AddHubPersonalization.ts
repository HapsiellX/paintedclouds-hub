import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubPersonalization1785001000000 implements MigrationInterface {
  name = 'AddHubPersonalization1785001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "hub_user_profile" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "enabled" boolean NOT NULL DEFAULT (1),
      "preferredMediaKinds" text, "preferredGenres" text, "preferredLanguages" text,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
      "userId" integer, CONSTRAINT "UQ_hub_user_profile_user" UNIQUE ("userId"),
      CONSTRAINT "FK_hub_user_profile_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "hub_user_signal" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "kind" varchar NOT NULL,
      "provider" varchar NOT NULL, "externalId" varchar NOT NULL,
      "liked" boolean NOT NULL DEFAULT (0), "hidden" boolean NOT NULL DEFAULT (0),
      "saved" boolean NOT NULL DEFAULT (0), "title" varchar, "subtitle" varchar,
      "imageUrl" varchar, "genres" text, "languages" text, "formats" text,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
      "userId" integer, CONSTRAINT "UQ_hub_user_signal_item" UNIQUE ("userId", "provider", "externalId", "kind"),
      CONSTRAINT "FK_hub_user_signal_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_user_signal_user" ON "hub_user_signal" ("userId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hub_user_signal"`);
    await queryRunner.query(`DROP TABLE "hub_user_profile"`);
  }
}
