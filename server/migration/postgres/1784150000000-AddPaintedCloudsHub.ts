import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaintedCloudsHub1784150000000 implements MigrationInterface {
  name = 'AddPaintedCloudsHub1784150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "hub_request" (
      "id" SERIAL NOT NULL,
      "kind" character varying NOT NULL,
      "provider" character varying NOT NULL,
      "externalId" character varying NOT NULL,
      "title" character varying NOT NULL,
      "subtitle" character varying,
      "imageUrl" character varying,
      "formats" text,
      "languages" text,
      "state" character varying NOT NULL DEFAULT 'pending',
      "points" integer NOT NULL,
      "targetService" character varying,
      "targetId" character varying,
      "errorMessage" text,
      "idempotencyKey" character varying NOT NULL,
      "requestedById" integer,
      "approvedById" integer,
      "approvedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_hub_request" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_hub_request_item" UNIQUE ("provider", "externalId", "kind"),
      CONSTRAINT "UQ_hub_request_idempotency" UNIQUE ("idempotencyKey"),
      CONSTRAINT "FK_hub_request_user" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_request_approver" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE "hub_audit_event" (
      "id" SERIAL NOT NULL,
      "action" character varying NOT NULL,
      "details" text,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "requestId" integer,
      "actorId" integer,
      CONSTRAINT "PK_hub_audit_event" PRIMARY KEY ("id"),
      CONSTRAINT "FK_hub_audit_request" FOREIGN KEY ("requestId") REFERENCES "hub_request"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_audit_actor" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_audit_request" ON "hub_audit_event" ("requestId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hub_audit_event"`);
    await queryRunner.query(`DROP TABLE "hub_request"`);
  }
}
