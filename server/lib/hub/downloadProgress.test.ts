import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { summarizeHubDownloads } from './downloadProgress';

const item = (overrides: Partial<DownloadingItem> = {}): DownloadingItem => ({
  mediaType: MediaType.TV,
  externalId: 12,
  size: 1_000,
  sizeLeft: 250,
  status: 'downloading',
  timeLeft: '00:10:00',
  estimatedCompletionTime: new Date('2026-07-18T20:00:00Z'),
  title: 'private release name',
  downloadId: 'download-1',
  ...overrides,
});

describe('summarizeHubDownloads', () => {
  it('calculates movie progress without exposing queue identifiers or titles', () => {
    const summary = summarizeHubDownloads([
      item({ mediaType: MediaType.MOVIE }),
    ]);

    assert.equal(summary?.progress, 75);
    assert.equal(summary?.downloadedBytes, 750);
    assert.equal(summary?.totalBytes, 1_000);
    assert.equal(
      summary?.parts[0].estimatedCompletionTime,
      '2026-07-18T20:00:00.000Z'
    );
    assert.ok(!JSON.stringify(summary).includes('private release name'));
    assert.ok(!JSON.stringify(summary).includes('download-1'));
  });

  it('groups season packs once while retaining their episode numbers', () => {
    const summary = summarizeHubDownloads([
      item({
        episode: {
          seasonNumber: 2,
          episodeNumber: 2,
          absoluteEpisodeNumber: 12,
          id: 2,
        },
      }),
      item({
        episode: {
          seasonNumber: 2,
          episodeNumber: 1,
          absoluteEpisodeNumber: 11,
          id: 1,
        },
      }),
    ]);

    assert.equal(summary?.progress, 75);
    assert.equal(summary?.parts.length, 1);
    assert.equal(summary?.episodeCount, 2);
    assert.deepStrictEqual(summary?.parts[0].episodes, [
      { seasonNumber: 2, episodeNumber: 1 },
      { seasonNumber: 2, episodeNumber: 2 },
    ]);
  });

  it('returns no progress for an empty queue', () => {
    assert.equal(summarizeHubDownloads([]), undefined);
  });
});
