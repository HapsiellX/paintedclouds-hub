import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildHubRecentMusicQuery,
  HubCatalogItemNotFoundError,
  rankRelevantBookResults,
  resolveHubCatalogItem,
  selectMajorStreamingProviderIds,
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
  it('builds bounded current-release queries for genres and artists', () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    assert.strictEqual(
      buildHubRecentMusicQuery({ genre: 'rock "live"' }, now),
      'firstreleasedate:[2026-01-17 TO 2026-07-17] AND primarytype:(album OR single OR ep) AND tag:"rock \\"live\\""'
    );
    assert.match(
      buildHubRecentMusicQuery(
        { artistId: '123e4567-e89b-42d3-a456-426614174000' },
        now
      ),
      /arid:123e4567-e89b-42d3-a456-426614174000$/
    );
  });

  it('selects streaming services and excludes linear television providers', () => {
    assert.deepStrictEqual(
      selectMajorStreamingProviderIds([
        { provider_id: 8, provider_name: 'Netflix' },
        { provider_id: 9, provider_name: 'Amazon Prime Video' },
        { provider_id: 337, provider_name: 'Disney Plus' },
        { provider_id: 283, provider_name: 'Crunchyroll' },
        { provider_id: 100, provider_name: 'ARD Mediathek' },
      ]),
      [8, 9, 337, 283]
    );
  });

  it('removes broad catalog matches that do not meaningfully match a specialist title', () => {
    const query =
      'Das Bistum Hildesheim im Mittelalter Geistliche Herrschaft und herrschaftlicher Raum';
    const results = rankRelevantBookResults(query, [
      {
        kind: HubMediaKind.BOOK,
        provider: 'lobid',
        externalId: '990013748890108971',
        title: 'Das Bistum Hildesheim im Mittelalter',
        subtitle: 'Geistliche Herrschaft und herrschaftlicher Raum',
      },
      {
        kind: HubMediaKind.BOOK,
        provider: 'lobid',
        externalId: '991000301749706483',
        title: 'Die evangelischen Kirchenordnungen des 16. Jahrhunderts',
        subtitle: 'Geistliche Gebiete und Herrschaften',
      },
    ]);

    assert.deepStrictEqual(
      results.map((item) => item.externalId),
      ['990013748890108971']
    );
  });
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
      { musicBrainz, openLibrary: unusedClient, lobid: unusedClient }
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
      { musicBrainz: unusedClient, openLibrary, lobid: unusedClient }
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
        { musicBrainz: client, openLibrary: client, lobid: client }
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
        { musicBrainz, openLibrary: unusedClient, lobid: unusedClient }
      ),
      HubCatalogItemNotFoundError
    );
  });

  it('resolves canonical lobid book metadata and ISBNs from a fixed endpoint', async () => {
    const calls: string[] = [];
    const lobid = {
      get: async (path: string) => {
        calls.push(path);
        return {
          data: {
            id: 'http://lobid.org/resources/990013748890108971#!',
            title: 'Die Synoden im Reichsgebiet',
            responsibilityStatement: ['Heinz Wolter'],
            publication: [{ startDate: '1988', publishedBy: ['Schöningh'] }],
            isbn: ['3506746871', '9783506746870'],
            language: [{ id: 'http://id.loc.gov/vocabulary/iso639-2/ger' }],
            type: ['BibliographicResource', 'Book'],
          },
        };
      },
    } as unknown as CatalogClient;

    const item = await resolveHubCatalogItem(
      {
        kind: HubMediaKind.BOOK,
        provider: 'lobid',
        externalId: '990013748890108971',
      },
      { musicBrainz: unusedClient, openLibrary: unusedClient, lobid }
    );

    assert.deepStrictEqual(calls, ['/990013748890108971.json']);
    assert.strictEqual(item.title, 'Die Synoden im Reichsgebiet');
    assert.strictEqual(item.subtitle, 'Heinz Wolter');
    assert.strictEqual(item.year, 1988);
    assert.deepStrictEqual(item.languages, ['ger']);
  });
});
