import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HubCatalogItem } from '@server/api/hub/catalog';
import { HubMediaKind } from '@server/constants/hub';
import {
  diversifyHubRecommendations,
  hubItemKey,
  rankHubRecommendations,
} from './recommendations';

const candidates: HubCatalogItem[] = [
  {
    kind: HubMediaKind.MOVIE,
    provider: 'tmdb',
    externalId: '1',
    title: 'Deutsch',
    genres: ['fantasy'],
    languages: ['de'],
    popularity: 10,
  },
  {
    kind: HubMediaKind.TV,
    provider: 'tmdb',
    externalId: '2',
    title: 'Liked match',
    genres: ['metal'],
    languages: ['en'],
    popularity: 1,
  },
  {
    kind: HubMediaKind.BOOK,
    provider: 'openlibrary',
    externalId: 'OL3W',
    title: 'Popular',
    genres: [],
    popularity: 100,
  },
];

const context = {
  preferredKinds: [] as HubMediaKind[],
  preferredGenres: ['fantasy'],
  preferredLanguages: ['de'],
  signals: [],
  requestedKeys: new Set<string>(),
  availableKeys: new Set<string>(),
};

describe('Hub recommendation ranking', () => {
  it('uses likes as the strongest signal, ahead of preferences and popularity', () => {
    const ranked = rankHubRecommendations(candidates, {
      ...context,
      signals: [
        {
          kind: HubMediaKind.MUSIC_ALBUM,
          provider: 'musicbrainz',
          externalId: '123e4567-e89b-42d3-a456-426614174000',
          liked: true,
          genres: ['metal'],
        },
      ],
    });
    assert.strictEqual(ranked[0].title, 'Liked match');
    assert.strictEqual(
      ranked[0].recommendationReasons?.[0].code,
      'LIKED_SIMILAR'
    );
  });

  it('excludes hidden titles and separates available items for rediscovery', () => {
    const hiddenKey = hubItemKey(candidates[0]);
    const availableKey = hubItemKey(candidates[1]);
    const ranked = rankHubRecommendations(candidates, {
      ...context,
      signals: [{ ...candidates[0], hidden: true }],
      availableKeys: new Set([availableKey]),
    });
    assert.ok(!ranked.some((item) => hubItemKey(item) === hiddenKey));
    assert.strictEqual(
      ranked.find((item) => hubItemKey(item) === availableKey)?.available,
      true
    );
  });

  it('is deterministic and diversifies the mixed feed by media kind', () => {
    const first = rankHubRecommendations(candidates, context);
    const second = rankHubRecommendations([...candidates].reverse(), context);
    assert.deepStrictEqual(first.map(hubItemKey), second.map(hubItemKey));
    const diversified = diversifyHubRecommendations(
      [...first, { ...candidates[0], externalId: '4' }],
      3
    );
    assert.strictEqual(new Set(diversified.map((item) => item.kind)).size, 3);
  });

  it('uses language/genre preferences and a stable cold-start reason', () => {
    const preferred = rankHubRecommendations(candidates, context);
    assert.strictEqual(preferred[0].title, 'Deutsch');
    assert.ok(
      preferred[0].recommendationReasons?.some(
        (reason) => reason.code === 'PREFERRED_LANGUAGE'
      )
    );
    const cold = rankHubRecommendations(candidates, {
      ...context,
      preferredGenres: [],
      preferredLanguages: [],
    });
    assert.ok(
      cold[0].recommendationReasons?.some(
        (reason) => reason.code === 'POPULAR_COLD_START'
      )
    );
  });

  it('uses own request and local library genres without other user data', () => {
    const ranked = rankHubRecommendations(candidates, {
      ...context,
      preferredGenres: [],
      preferredLanguages: [],
      requestedGenres: ['metal'],
      libraryGenres: ['fantasy'],
    });
    assert.ok(
      ranked
        .find((item) => item.title === 'Liked match')
        ?.recommendationReasons?.some(
          (reason) => reason.code === 'REQUEST_SIMILAR'
        )
    );
    assert.ok(
      ranked
        .find((item) => item.title === 'Deutsch')
        ?.recommendationReasons?.some(
          (reason) => reason.code === 'LIBRARY_SIMILAR'
        )
    );
  });

  it('prefers a current title when stronger personal signals are equal', () => {
    const ranked = rankHubRecommendations(
      [
        {
          ...candidates[0],
          externalId: '10',
          title: 'Older title',
          freshness: 0.1,
        },
        {
          ...candidates[0],
          externalId: '11',
          title: 'Current title',
          freshness: 1,
        },
      ],
      context
    );
    assert.strictEqual(ranked[0].title, 'Current title');
  });
});
