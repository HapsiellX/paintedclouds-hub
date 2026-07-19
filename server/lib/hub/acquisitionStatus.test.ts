import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import {
  normalizeAcquisitionPhase,
  summarizeHubAcquisition,
} from './acquisitionStatus';

const item = (overrides: Partial<DownloadingItem> = {}): DownloadingItem => ({
  mediaType: MediaType.MOVIE,
  externalId: 1,
  size: 1_000,
  sizeLeft: 600,
  status: 'downloading',
  timeLeft: '00:10:00',
  estimatedCompletionTime: new Date('2026-07-19T12:00:00Z'),
  title: 'private.release.name',
  downloadId: 'private-id',
  source: 'radarr',
  ...overrides,
});

describe('Hub acquisition normalization', () => {
  it('distinguishes a misleading SAB downloading slot that is only queued', () => {
    assert.deepStrictEqual(
      normalizeAcquisitionPhase(
        item({ clientStatus: 'Downloading', clientActive: false })
      ),
      { phase: 'queued', health: 'ok' }
    );
    assert.equal(
      normalizeAcquisitionPhase(
        item({ clientStatus: 'Downloading', clientActive: true })
      ).phase,
      'downloading'
    );
  });

  it('gives post-processing and failures precedence over transfer status', () => {
    assert.equal(
      normalizeAcquisitionPhase(
        item({ clientStatus: 'Extracting', status: 'downloading' })
      ).phase,
      'extracting'
    );
    assert.deepStrictEqual(
      normalizeAcquisitionPhase(item({ trackedDownloadStatus: 'warning' })),
      {
        phase: 'failed',
        health: 'warning',
        reasonCode: 'provider_warning',
      }
    );
  });

  it('returns a privacy-safe weighted snapshot', () => {
    const result = summarizeHubAcquisition({ downloads: [item()] });
    assert.equal(result.progress, 40);
    assert.equal(result.phase, 'downloading');
    assert.deepStrictEqual(result.sources, ['radarr']);
    assert.ok(!JSON.stringify(result).includes('private.release.name'));
    assert.ok(!JSON.stringify(result).includes('private-id'));
  });
});
