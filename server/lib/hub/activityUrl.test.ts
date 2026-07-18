import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHubActivityUrl } from './activityUrl';

describe('buildHubActivityUrl', () => {
  it('omits empty optional filters from the default request URL', () => {
    assert.equal(
      buildHubActivityUrl({
        take: 20,
        skip: 0,
        kinds: '',
        formats: '',
        states: '',
        query: '',
      }),
      '/api/v1/hub/activity?take=20&skip=0'
    );
  });

  it('includes and encodes only active filters', () => {
    assert.equal(
      buildHubActivityUrl({
        take: 20,
        skip: 40,
        kinds: 'book',
        formats: 'ebook,audiobook',
        states: 'pending',
        query: 'Der Name & mehr',
      }),
      '/api/v1/hub/activity?take=20&skip=40&kinds=book&formats=ebook%2Caudiobook&states=pending&query=Der+Name+%26+mehr'
    );
  });
});
