import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaintedCloudsHub1784150000000 implements MigrationInterface {
  name = 'AddPaintedCloudsHub1784150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "hub_request" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "kind" varchar NOT NULL,
      "provider" varchar NOT NULL,
      "externalId" varchar NOT NULL,
      "title" varchar NOT NULL,
      "subtitle" varchar,
      "imageUrl" varchar,
      "formats" text,
      "languages" text,
      "state" varchar NOT NULL DEFAULT ('pending'),
      "points" integer NOT NULL,
      "targetService" varchar,
      "targetId" varchar,
      "errorMessage" text,
      "idempotencyKey" varchar NOT NULL,
      "requestedById" integer,
      "approvedById" integer,
      "approvedAt" datetime,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_hub_request_item" UNIQUE ("provider", "externalId", "kind"),
      CONSTRAINT "UQ_hub_request_idempotency" UNIQUE ("idempotencyKey"),
      CONSTRAINT "FK_hub_request_user" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_request_approver" FOREIGN KEY ("approvedById") REFERENCES "user" ("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE "hub_audit_event" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "action" varchar NOT NULL,
      "details" text,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "requestId" integer,
      "actorId" integer,
      CONSTRAINT "FK_hub_audit_request" FOREIGN KEY ("requestId") REFERENCES "hub_request" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_hub_audit_actor" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON DELETE SET NULL
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
