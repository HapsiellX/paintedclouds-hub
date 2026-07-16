import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HubCatalogItemNotFoundError,
  resolveHubCatalogItem,
} from '@server/api/hub/catalog';
import { HubMediaKind } from '@server/constants/hub';
import type { AxiosInstance } from 'axios';

type CatalogClient = Pick<AxiosInstance, 'get'>;

const unusedClient = {
  get: async () => {
    throw new Error('unexpected provider call');
  },
} as unknown as CatalogClient;

describe('Hub catalog item resolution', () => {
  it('resolves canonical MusicBrainz album metadata from a fixed endpoint', async () => {
    const calls: string[] = [];
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const musicBrainz = {
      get: async (path: string) => {
        calls.push(path);
        return {
          data: {
            id,
            title: '  Canonical Album  ',
            'artist-credit': [{ name: 'Canonical Artist' }],
            'first-release-date': '2024-03-01',
          },
        };
      },
    } as unknown as CatalogClient;

    const item = await resolveHubCatalogItem(
      {
        kind: HubMediaKind.MUSIC_ALBUM,
        provider: 'musicbrainz',
        externalId: id,
      },
      { musicBrainz, openLibrary: unusedClient }
    );

    assert.deepStrictEqual(calls, [`/release-group/${id}`]);
    assert.strictEqual(item.title, 'Canonical Album');
    assert.strictEqual(item.subtitle, 'Canonical Artist');
    assert.strictEqual(
      item.imageUrl,
      `https://coverartarchive.org/release-group/${id}/front-500`
    );
    assert.strictEqual(item.year, 2024);
  });

  it('resolves canonical Open Library work, author and cover metadata', async () => {
    const calls: string[] = [];
    const openLibrary = {
      get: async (path: string) => {
        calls.push(path);
        if (path === '/works/OL123W.json') {
          return {
            data: {
              key: '/works/OL123W',
              title: 'Canonical Book',
              covers: [-1, 9876],
              authors: [{ author: { key: '/authors/OL42A' } }],
            },
          };
        }
        return { data: { name: 'Canonical Author' } };
      },
    } as unknown as CatalogClient;

    const item = await resolveHubCatalogItem(
      {
        kind: HubMediaKind.BOOK,
        provider: 'openlibrary',
        externalId: 'OL123W',
      },
      { musicBrainz: unusedClient, openLibrary }
    );

    assert.deepStrictEqual(calls, [
      '/works/OL123W.json',
      '/authors/OL42A.json',
    ]);
    assert.strictEqual(item.title, 'Canonical Book');
    assert.strictEqual(item.subtitle, 'Canonical Author');
    assert.strictEqual(
      item.imageUrl,
      'https://covers.openlibrary.org/b/id/9876-L.jpg'
    );
  });

  it('rejects malformed identities before making any provider request', async () => {
    let calls = 0;
    const client = {
      get: async () => {
        calls += 1;
        return { data: {} };
      },
    } as unknown as CatalogClient;

    await assert.rejects(
      resolveHubCatalogItem(
        {
          kind: HubMediaKind.BOOK,
          provider: 'openlibrary',
          externalId: '../admin',
        },
        { musicBrainz: client, openLibrary: client }
      ),
      HubCatalogItemNotFoundError
    );
    assert.strictEqual(calls, 0);
  });

  it('rejects provider responses whose identity does not match', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const musicBrainz = {
      get: async () => ({
        data: {
          id: '223e4567-e89b-42d3-a456-426614174000',
          title: 'Wrong record',
        },
      }),
    } as unknown as CatalogClient;

    await assert.rejects(
      resolveHubCatalogItem(
        {
          kind: HubMediaKind.MUSIC_ALBUM,
          provider: 'musicbrainz',
          externalId: id,
        },
        { musicBrainz, openLibrary: unusedClient }
      ),
      HubCatalogItemNotFoundError
    );
  });
});
