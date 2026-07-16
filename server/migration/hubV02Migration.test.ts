import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DataSource } from 'typeorm';

import { AddPaintedCloudsHub1784150000000 as AddHubPostgres } from './postgres/1784150000000-AddPaintedCloudsHub';
import { AddHubV02Foundation1785000000000 as AddV02Postgres } from './postgres/1785000000000-AddHubV02Foundation';
import { AddPaintedCloudsHub1784150000000 as AddHubSqlite } from './sqlite/1784150000000-AddPaintedCloudsHub';
import { AddHubV02Foundation1785000000000 as AddV02Sqlite } from './sqlite/1785000000000-AddHubV02Foundation';

describe('PaintedClouds Hub V0.2 migrations', () => {
  it('upgrades and rolls back the Hub schema on SQLite', async () => {
    const dataSource = await new DataSource({
      type: 'sqlite',
      database: ':memory:',
    }).initialize();
    const runner = dataSource.createQueryRunner();
    try {
      await runner.query(
        'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
      );
      await new AddHubSqlite().up(runner);
      await new AddV02Sqlite().up(runner);
      const tables = await runner.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      assert.ok(
        tables.some(
          (table: { name: string }) => table.name === 'hub_quota_ledger'
        )
      );
      assert.ok(
        tables.some(
          (table: { name: string }) => table.name === 'hub_metadata_cache'
        )
      );
      const columns = await runner.query('PRAGMA table_info("hub_request")');
      assert.ok(
        columns.some((column: { name: string }) => column.name === 'editionId')
      );
      assert.ok(
        columns.some(
          (column: { name: string }) => column.name === 'lastSyncedAt'
        )
      );
      await new AddV02Sqlite().down(runner);
      await new AddHubSqlite().down(runner);
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  });

  it(
    'upgrades and rolls back the Hub schema on PostgreSQL',
    { skip: !process.env.HUB_TEST_POSTGRES_URL },
    async () => {
      const dataSource = await new DataSource({
        type: 'postgres',
        url: process.env.HUB_TEST_POSTGRES_URL,
      }).initialize();
      const runner = dataSource.createQueryRunner();
      try {
        await runner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
        await runner.query('CREATE TABLE "user" ("id" SERIAL PRIMARY KEY)');
        await new AddHubPostgres().up(runner);
        await new AddV02Postgres().up(runner);
        const tables = await runner.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        );
        assert.ok(
          tables.some(
            (table: { table_name: string }) =>
              table.table_name === 'hub_quota_ledger'
          )
        );
        assert.ok(
          tables.some(
            (table: { table_name: string }) =>
              table.table_name === 'hub_metadata_cache'
          )
        );
        const columns = await runner.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='hub_request'"
        );
        assert.ok(
          columns.some(
            (column: { column_name: string }) =>
              column.column_name === 'editionId'
          )
        );
        assert.ok(
          columns.some(
            (column: { column_name: string }) =>
              column.column_name === 'lastSyncedAt'
          )
        );
        await new AddV02Postgres().down(runner);
        await new AddHubPostgres().down(runner);
      } finally {
        await runner.release();
        await dataSource.destroy();
      }
    }
  );
});
