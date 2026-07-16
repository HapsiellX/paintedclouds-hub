import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubV02Foundation1785000000000 implements MigrationInterface {
  name = 'AddHubV02Foundation1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hub_request" ADD "editionId" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_request" ADD "isbn" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "hub_request" ADD "lastSyncedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "hubQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "hubQuotaDays" integer`);
    await queryRunner.query(`CREATE TABLE "hub_quota_ledger" (
      "id" SERIAL NOT NULL,
      "points" integer NOT NULL,
      "state" character varying NOT NULL DEFAULT 'reserved',
      "consumedAt" TIMESTAMP WITH TIME ZONE,
      "releasedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "requestId" integer,
      "userId" integer,
      CONSTRAINT "PK_hub_quota_ledger" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_hub_quota_request" UNIQUE ("requestId"),
      CONSTRAINT "FK_hub_quota_request" FOREIGN KEY ("requestId") REFERENCES "hub_request"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_quota_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_quota_user" ON "hub_quota_ledger" ("userId")`
    );
    await queryRunner.query(`CREATE TABLE "hub_metadata_cache" (
      "id" SERIAL NOT NULL,
      "provider" character varying NOT NULL,
      "cacheKey" character varying NOT NULL,
      "payload" text NOT NULL,
      "etag" character varying,
      "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "staleUntil" TIMESTAMP WITH TIME ZONE NOT NULL,
      "lastError" text,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_hub_metadata_cache" PRIMARY KEY ("id"),
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
