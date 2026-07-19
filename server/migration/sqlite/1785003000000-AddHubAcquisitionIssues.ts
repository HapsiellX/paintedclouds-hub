import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubAcquisitionIssues1785003000000 implements MigrationInterface {
  name = 'AddHubAcquisitionIssues1785003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hub_acquisition_issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestSource" varchar NOT NULL, "requestId" integer NOT NULL, "kind" varchar NOT NULL, "externalId" varchar NOT NULL, "is4k" boolean NOT NULL DEFAULT (0), "reasonCode" varchar NOT NULL, "partKey" varchar NOT NULL DEFAULT (''), "message" varchar NOT NULL, "retryable" boolean NOT NULL DEFAULT (1), "acknowledgedAt" datetime, "resolvedAt" datetime, "lastSeenAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer NOT NULL, CONSTRAINT "FK_hub_acquisition_issue_user" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_hub_acquisition_issue_request" ON "hub_acquisition_issue" ("requestSource", "requestId", "is4k", "partKey", "reasonCode")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_acquisition_issue_user_resolved" ON "hub_acquisition_issue" ("requestedById", "resolvedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_acquisition_issue_resolved" ON "hub_acquisition_issue" ("resolvedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_hub_acquisition_issue_resolved"`);
    await queryRunner.query(
      `DROP INDEX "IDX_hub_acquisition_issue_user_resolved"`
    );
    await queryRunner.query(`DROP INDEX "IDX_hub_acquisition_issue_request"`);
    await queryRunner.query(`DROP TABLE "hub_acquisition_issue"`);
  }
}
