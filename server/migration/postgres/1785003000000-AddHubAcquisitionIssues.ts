import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubAcquisitionIssues1785003000000 implements MigrationInterface {
  name = 'AddHubAcquisitionIssues1785003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hub_acquisition_issue" ("id" SERIAL NOT NULL, "requestSource" character varying NOT NULL, "requestId" integer NOT NULL, "kind" character varying NOT NULL, "externalId" character varying NOT NULL, "is4k" boolean NOT NULL DEFAULT false, "reasonCode" character varying NOT NULL, "partKey" character varying NOT NULL DEFAULT '', "message" character varying NOT NULL, "retryable" boolean NOT NULL DEFAULT true, "acknowledgedAt" TIMESTAMP WITH TIME ZONE, "resolvedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "requestedById" integer NOT NULL, CONSTRAINT "PK_hub_acquisition_issue" PRIMARY KEY ("id"), CONSTRAINT "FK_hub_acquisition_issue_user" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
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
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hub_acquisition_issue_resolved"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hub_acquisition_issue_user_resolved"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hub_acquisition_issue_request"`
    );
    await queryRunner.query(`DROP TABLE "hub_acquisition_issue"`);
  }
}
