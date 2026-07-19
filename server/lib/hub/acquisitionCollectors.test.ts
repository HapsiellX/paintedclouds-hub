import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HubMediaKind } from '@server/constants/hub';
import {
  clearHubAcquisitionCollectorCache,
  getSharedLidarrQueue,
  lazyLibrarianAcquisitionPhase,
  loadLidarrQueuePages,
  matchesLidarrQueueRecord,
} from './acquisitionCollectors';

describe('Hub acquisition collectors', () => {
  it('matches Lidarr artist and album queue records by their kind-specific ID', () => {
    const record = { artistId: 12, albumId: 34 };
    assert.equal(
      matchesLidarrQueueRecord(HubMediaKind.MUSIC_ARTIST, '12', record),
      true
    );
    assert.equal(
      matchesLidarrQueueRecord(HubMediaKind.MUSIC_ARTIST, '34', record),
      false
    );
    assert.equal(
      matchesLidarrQueueRecord(HubMediaKind.MUSIC_ALBUM, '34', record),
      true
    );
    assert.equal(
      matchesLidarrQueueRecord(HubMediaKind.MUSIC_ALBUM, '12', record),
      false
    );
  });

  it('does not confuse a downloaded LazyLibrarian record with downloading', () => {
    assert.equal(lazyLibrarianAcquisitionPhase('downloaded'), 'available');
    assert.equal(lazyLibrarianAcquisitionPhase('download failed'), 'failed');
  });

  it('finds Lidarr queue records beyond page one with their global position', async () => {
    const calls: number[] = [];
    const client = {
      get: async (
        _url: string,
        config?: { params?: Record<string, unknown> }
      ) => {
        const page = Number(config?.params?.page);
        calls.push(page);
        return {
          data: {
            totalRecords: 251,
            records:
              page === 1
                ? Array.from({ length: 250 }, (_, artistId) => ({ artistId }))
                : [{ artistId: 999 }],
          },
        };
      },
    };
    const records = await loadLidarrQueuePages(client);
    assert.deepStrictEqual(calls, [1, 2]);
    assert.deepStrictEqual(records.at(-1), {
      item: { artistId: 999 },
      queuePosition: 251,
    });
  });

  it('deduplicates the shared Lidarr queue snapshot within its TTL', async () => {
    clearHubAcquisitionCollectorCache();
    let calls = 0;
    const client = {
      get: async () => {
        calls += 1;
        return { data: { totalRecords: 0, records: [] } };
      },
    };
    await Promise.all([
      getSharedLidarrQueue('same-provider', client),
      getSharedLidarrQueue('same-provider', client),
    ]);
    assert.strictEqual(calls, 1);
    clearHubAcquisitionCollectorCache();
  });
});
