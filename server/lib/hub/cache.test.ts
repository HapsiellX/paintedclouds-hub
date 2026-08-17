import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { HubMetadataCache } from '@server/entity/HubMetadataCache';
import { withHubMetadataCache } from '@server/lib/hub/cache';
import { setupTestDb } from '@server/test/db';

setupTestDb();

beforeEach(async () => {
  await getRepository(HubMetadataCache).createQueryBuilder().delete().execute();
});

describe('Hub metadata cache', () => {
  it('does not persist partial provider responses', async () => {
    let loads = 0;
    const load = async () => ({ results: [], errors: [`failure-${++loads}`] });
    const shouldCache = (value: Awaited<ReturnType<typeof load>>) =>
      value.errors.length === 0;

    const first = await withHubMetadataCache(
      'catalog',
      'partial-search',
      load,
      60_000,
      shouldCache
    );
    const second = await withHubMetadataCache(
      'catalog',
      'partial-search',
      load,
      60_000,
      shouldCache
    );

    assert.deepStrictEqual(first.errors, ['failure-1']);
    assert.deepStrictEqual(second.errors, ['failure-2']);
    assert.strictEqual(loads, 2);
    assert.strictEqual(await getRepository(HubMetadataCache).count(), 0);
  });
});
