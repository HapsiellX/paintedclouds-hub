import { HubRequestState } from '@server/constants/hub';
import {
  lazyLibrarianRecordState,
  lidarrStatisticsState,
} from '@server/lib/hub/reconciliation';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('PaintedClouds Hub reconciliation state mapping', () => {
  it('maps Lidarr progress without treating empty statistics as available', () => {
    assert.equal(lidarrStatisticsState({}), undefined);
    assert.equal(
      lidarrStatisticsState({ trackFileCount: 4, totalTrackCount: 10 }),
      HubRequestState.IMPORTED
    );
    assert.equal(
      lidarrStatisticsState({ trackFileCount: 10, totalTrackCount: 10 }),
      HubRequestState.AVAILABLE
    );
  });

  it('normalizes known LazyLibrarian states and falls back safely', () => {
    assert.equal(
      lazyLibrarianRecordState({ bookStatus: 'Downloaded' }),
      HubRequestState.AVAILABLE
    );
    assert.equal(
      lazyLibrarianRecordState({ status: 'Snatched' }),
      HubRequestState.DOWNLOADING
    );
    assert.equal(
      lazyLibrarianRecordState({ status: 'Unknown future state' }),
      HubRequestState.SUBMITTED
    );
  });
});
