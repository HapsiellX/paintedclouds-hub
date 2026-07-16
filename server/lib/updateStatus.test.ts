import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isReleaseUpdateAvailable } from './updateStatus';

const release = (
  tag_name: string,
  options: { draft?: boolean; prerelease?: boolean } = {}
) => ({
  tag_name,
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? false,
});

describe('PaintedClouds Hub update status', () => {
  it('compares exact semantic tags instead of mutable release names', () => {
    assert.equal(isReleaseUpdateAvailable('0.2.0', [release('v0.3.0')]), true);
    assert.equal(isReleaseUpdateAvailable('0.3.0', [release('v0.3.0')]), false);
  });

  it('ignores drafts, invalid tags, and prereleases on the stable channel', () => {
    assert.equal(
      isReleaseUpdateAvailable('0.3.0', [
        release('nightly'),
        release('v0.4.0', { draft: true }),
        release('v0.4.0-rc.1', { prerelease: true }),
      ]),
      false
    );
  });

  it('allows prerelease installations to advance to a newer RC or stable tag', () => {
    assert.equal(
      isReleaseUpdateAvailable('0.3.0-rc.1', [
        release('v0.3.0-rc.2', { prerelease: true }),
      ]),
      true
    );
    assert.equal(
      isReleaseUpdateAvailable('0.3.0-rc.2', [release('v0.3.0')]),
      true
    );
  });

  it('fails closed when the current version or release feed is unavailable', () => {
    assert.equal(
      isReleaseUpdateAvailable('local', [release('v99.0.0')]),
      false
    );
    assert.equal(isReleaseUpdateAvailable('0.3.0', []), false);
  });
});
