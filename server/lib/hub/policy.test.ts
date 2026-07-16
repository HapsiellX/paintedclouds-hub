import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HubMediaKind,
  HubRequestFormat,
  hubRequestPoints,
} from '@server/constants/hub';

describe('PaintedClouds Hub request points', () => {
  it('weights video and music requests', () => {
    assert.equal(hubRequestPoints(HubMediaKind.MOVIE), 1);
    assert.equal(hubRequestPoints(HubMediaKind.TV), 3);
    assert.equal(hubRequestPoints(HubMediaKind.MUSIC_ALBUM), 1);
    assert.equal(hubRequestPoints(HubMediaKind.MUSIC_ARTIST), 5);
  });

  it('weights each requested book format', () => {
    assert.equal(
      hubRequestPoints(HubMediaKind.BOOK, [HubRequestFormat.EBOOK]),
      1
    );
    assert.equal(
      hubRequestPoints(HubMediaKind.BOOK, [HubRequestFormat.AUDIOBOOK]),
      2
    );
    assert.equal(
      hubRequestPoints(HubMediaKind.BOOK, [
        HubRequestFormat.EBOOK,
        HubRequestFormat.AUDIOBOOK,
      ]),
      3
    );
  });
});
