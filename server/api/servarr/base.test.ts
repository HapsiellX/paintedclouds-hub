import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ServarrBase, { type HistoryItem } from './base';

class TestServarr extends ServarrBase<Record<string, never>> {
  constructor() {
    super({
      url: 'http://servarr.test/api/v3',
      apiKey: 'test',
      cacheName: 'radarr',
      apiName: 'Test',
    });
  }

  public mockGet(
    handler: (
      url: string,
      config?: { params?: Record<string, unknown> }
    ) => Promise<unknown>
  ): void {
    this.axios.get = handler as typeof this.axios.get;
  }
}

describe('Servarr pagination', () => {
  it('loads history pages until the seven-day cutoff and requests episodes', async () => {
    const api = new TestServarr();
    const calls: { page: number; includeEpisode: boolean }[] = [];
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString();
    api.mockGet(async (_url, config) => {
      const page = Number(config?.params?.page);
      calls.push({
        page,
        includeEpisode: Boolean(config?.params?.includeEpisode),
      });
      const records: HistoryItem[] =
        page === 1
          ? Array.from({ length: 250 }, (_, id) => ({
              id,
              eventType: 'downloadFailed',
              date: recent,
            }))
          : [{ id: 251, eventType: 'downloadFailed', date: old }];
      return { data: { totalRecords: 500, records } };
    });
    assert.strictEqual((await api.getRecentHistory()).length, 250);
    assert.deepStrictEqual(calls, [
      { page: 1, includeEpisode: true },
      { page: 2, includeEpisode: true },
    ]);
  });

  it('stops queue pagination on an empty page with an inconsistent total', async () => {
    const api = new TestServarr();
    const calls: number[] = [];
    api.mockGet(async (_url, config) => {
      const page = Number(config?.params?.page);
      calls.push(page);
      return {
        data: {
          totalRecords: 10_000,
          records:
            page === 1 ? Array.from({ length: 250 }, (_, id) => ({ id })) : [],
        },
      };
    });
    assert.strictEqual((await api.getQueue()).length, 250);
    assert.deepStrictEqual(calls, [1, 2]);
  });

  it('caps history pagination when the provider total never converges', async () => {
    const api = new TestServarr();
    let calls = 0;
    const recent = new Date().toISOString();
    api.mockGet(async () => {
      calls += 1;
      return {
        data: {
          totalRecords: 1_000_000,
          records: Array.from({ length: 250 }, (_, id) => ({
            id: calls * 1_000 + id,
            eventType: 'downloadFailed',
            date: recent,
          })),
        },
      };
    });
    assert.strictEqual((await api.getRecentHistory()).length, 5_000);
    assert.strictEqual(calls, 20);
  });
});
