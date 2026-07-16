import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubV02Foundation1785000000000 implements MigrationInterface {
  name = 'AddHubV02Foundation1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_request" ADD "editionId" varchar`
    );
    await queryRunner.query(`ALTER TABLE "hub_request" ADD "isbn" varchar`);
    await queryRunner.query(
      `ALTER TABLE "hub_request" ADD "lastSyncedAt" datetime`
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "hubQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "hubQuotaDays" integer`);
    await queryRunner.query(`CREATE TABLE "hub_quota_ledger" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "points" integer NOT NULL,
      "state" varchar NOT NULL DEFAULT ('reserved'),
      "consumedAt" datetime,
      "releasedAt" datetime,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
      "requestId" integer,
      "userId" integer,
      CONSTRAINT "UQ_hub_quota_request" UNIQUE ("requestId"),
      CONSTRAINT "FK_hub_quota_request" FOREIGN KEY ("requestId") REFERENCES "hub_request" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_quota_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_quota_user" ON "hub_quota_ledger" ("userId")`
    );
    await queryRunner.query(`CREATE TABLE "hub_metadata_cache" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "provider" varchar NOT NULL,
      "cacheKey" varchar NOT NULL,
      "payload" text NOT NULL,
      "etag" varchar,
      "expiresAt" datetime NOT NULL,
      "staleUntil" datetime NOT NULL,
      "lastError" text,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_hub_metadata_cache" UNIQUE ("provider", "cacheKey")
    )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hub_metadata_cache"`);
    await queryRunner.query(`DROP TABLE "hub_quota_ledger"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "hubQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "hubQuotaLimit"`);
    await queryRunner.query(
      `ALTER TABLE "hub_request" DROP COLUMN "lastSyncedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_request" DROP COLUMN "editionId"`
    );
    await queryRunner.query(`ALTER TABLE "hub_request" DROP COLUMN "isbn"`);
  }
}
