import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';

import { createAuthRateLimiter } from './authRateLimit';

describe('createAuthRateLimiter', () => {
  it('blocks requests after the configured limit', async () => {
    const app = express();
    app.post(
      '/login',
      createAuthRateLimiter({ windowMs: 60_000, limit: 2 }),
      (_req, res) => res.status(401).send()
    );

    assert.strictEqual((await request(app).post('/login')).status, 401);
    assert.strictEqual((await request(app).post('/login')).status, 401);

    const blocked = await request(app).post('/login');
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
  });

  it('does not count successful requests when configured', async () => {
    const app = express();
    app.post(
      '/login',
      createAuthRateLimiter({
        windowMs: 60_000,
        limit: 1,
        skipSuccessfulRequests: true,
      }),
      (_req, res) => res.status(204).send()
    );

    assert.strictEqual((await request(app).post('/login')).status, 204);
    assert.strictEqual((await request(app).post('/login')).status, 204);
  });
});
