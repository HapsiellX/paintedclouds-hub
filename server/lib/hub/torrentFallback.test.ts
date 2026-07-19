import type { ServarrRelease } from '@server/api/servarr/base';
import assert from 'assert';
import { describe, it } from 'node:test';
import { selectTorrentRelease } from './torrentFallback';

const release = (overrides: Partial<ServarrRelease> = {}): ServarrRelease => ({
  guid: 'guid',
  indexerId: 1,
  title: 'private release title',
  protocol: 'torrent',
  seeders: 10,
  downloadAllowed: true,
  rejected: false,
  rejections: [],
  ...overrides,
});

describe('VPN-gated torrent fallback selection', () => {
  it('keeps Servarr order and selects the first accepted seeded torrent', () => {
    const selected = selectTorrentRelease(
      [
        release({ protocol: 'usenet' }),
        release({ guid: 'rejected', rejections: ['quality'] }),
        release({ guid: 'too-few-seeders', seeders: 1 }),
        release({ guid: 'accepted', seeders: 3 }),
        release({ guid: 'later', seeders: 100 }),
      ],
      2
    );
    assert.equal(selected?.guid, 'accepted');
  });

  it('fails closed when no torrent satisfies every safety condition', () => {
    assert.equal(
      selectTorrentRelease(
        [
          release({ downloadAllowed: false }),
          release({ rejected: true }),
          release({ seeders: undefined }),
        ],
        1
      ),
      undefined
    );
  });
});
