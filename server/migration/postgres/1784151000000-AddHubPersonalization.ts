import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubPersonalization1784151000000 implements MigrationInterface {
  name = 'AddHubPersonalization1784151000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "hub_user_profile" (
      "id" SERIAL NOT NULL, "enabled" boolean NOT NULL DEFAULT true,
      "preferredMediaKinds" text, "preferredGenres" text,
      "preferredLanguages" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer,
      CONSTRAINT "PK_hub_user_profile" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_hub_user_profile_user" UNIQUE ("userId"),
      CONSTRAINT "FK_hub_user_profile_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "hub_user_signal" (
      "id" SERIAL NOT NULL, "kind" character varying NOT NULL,
      "provider" character varying NOT NULL, "externalId" character varying NOT NULL,
      "liked" boolean NOT NULL DEFAULT false, "hidden" boolean NOT NULL DEFAULT false,
      "saved" boolean NOT NULL DEFAULT false, "title" character varying,
      "subtitle" character varying, "imageUrl" character varying, "genres" text,
      "languages" text, "formats" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer,
      CONSTRAINT "PK_hub_user_signal" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_hub_user_signal_item" UNIQUE ("userId", "provider", "externalId", "kind"),
      CONSTRAINT "FK_hub_user_signal_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
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
