import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { HubMediaKind, HubRequestState } from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { createHubRateLimiter } from '@server/lib/hub/rateLimit';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import hubRoutes from './hub';

let app: Express;

const sensitiveFields = new Set([
  'email',
  'password',
  'settings',
  'plexToken',
  'jellyfinAuthToken',
  'pushbulletAccessToken',
  'pushoverApplicationToken',
  'pushoverUserKey',
  'telegramChatId',
  'idempotencyKey',
]);

const assertNoSensitiveFields = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!sensitiveFields.has(key), `response exposed ${key}`);
    assertNoSensitiveFields(child);
  }
};

const createApp = () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  testApp.use(checkUser);
  testApp.use('/auth', authRoutes);
  testApp.use('/hub', isAuthenticated(), hubRoutes);
  testApp.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message })
  );
  return testApp;
};

setupTestDb();

before(() => {
  app = createApp();
});

beforeEach(async () => {
  await getRepository(HubAuditEvent).createQueryBuilder().delete().execute();
  await getRepository(HubRequest).createQueryBuilder().delete().execute();
});

const loginAs = async (email: string) => {
  const settings = getSettings();
  settings.main.localLogin = true;
  const agent = request.agent(app);
  const response = await agent
    .post('/auth/local')
    .send({ email, password: 'test1234' });
  assert.strictEqual(response.status, 200);
  return agent;
};

const seedHubRequest = async (
  email: string,
  externalId: string,
  errorMessage: string | null = null
) => {
  const user = await getRepository(User).findOneOrFail({ where: { email } });
  const userSettings =
    user.settings ??
    new UserSettings({
      user,
      notificationTypes: {},
      discordIds: [],
    });
  userSettings.pushbulletAccessToken = `secret-for-${user.id}`;
  userSettings.pushoverApplicationToken = `pushover-for-${user.id}`;
  user.settings = await getRepository(UserSettings).save(userSettings);

  return getRepository(HubRequest).save(
    new HubRequest({
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary',
      externalId,
      title: `Book ${externalId}`,
      state: errorMessage ? HubRequestState.FAILED : HubRequestState.PENDING,
      points: 1,
      requestedBy: user,
      idempotencyKey: `private-key-${externalId}`,
      errorMessage,
    })
  );
};

describe('Hub authorization and privacy', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/hub/requests');
    assert.strictEqual(response.status, 403);
  });

  it('shows non-admin users only their own minimized requests', async () => {
    const own = await seedHubRequest('friend@seerr.dev', 'OL100W');
    await seedHubRequest('admin@seerr.dev', 'OL200W');
    const agent = await loginAs('friend@seerr.dev');

    for (const path of ['/hub/requests', '/hub/overview']) {
      const response = await agent.get(path);
      assert.strictEqual(response.status, 200);
      const results = response.body.results ?? response.body.requests;
      assert.deepStrictEqual(
        results.map((item: { id: number }) => item.id),
        [own.id]
      );
      assertNoSensitiveFields(response.body);
      assert.ok(!JSON.stringify(response.body).includes('secret-for-'));
      assert.ok(!JSON.stringify(response.body).includes('pushover-for-'));
      assert.ok(!('approvedBy' in results[0]));
      assert.ok(!('targetService' in results[0]));
    }
  });

  it('gives admins all requests through minimized DTOs only', async () => {
    await seedHubRequest(
      'friend@seerr.dev',
      'OL300W',
      'connect ECONNREFUSED http://internal.example?apikey=do-not-leak'
    );
    await seedHubRequest('admin@seerr.dev', 'OL400W');
    const agent = await loginAs('admin@seerr.dev');

    const response = await agent.get('/hub/requests');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results.length, 2);
    assertNoSensitiveFields(response.body);
    const serialized = JSON.stringify(response.body);
    assert.ok(!serialized.includes('do-not-leak'));
    assert.ok(!serialized.includes('internal.example'));
    assert.ok(serialized.includes('Mediendienst fehlgeschlagen'));
  });

  it('returns a constant, entity-free conflict response', async () => {
    await seedHubRequest('admin@seerr.dev', 'OL500W');
    const agent = await loginAs('friend@seerr.dev');
    const response = await agent.post('/hub/requests').send({
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary',
      externalId: 'OL500W',
      title: 'Duplicate',
    });

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.body, {
      code: 'HUB_REQUEST_EXISTS',
      message: 'Dieser Titel wurde bereits gewünscht.',
    });
    assertNoSensitiveFields(response.body);
  });

  it('rejects invalid provider combinations, IDs, image hosts and bounds', async () => {
    const agent = await loginAs('friend@seerr.dev');
    const invalidBodies = [
      {
        kind: HubMediaKind.BOOK,
        provider: 'musicbrainz',
        externalId: 'OL600W',
        title: 'Wrong provider',
      },
      {
        kind: HubMediaKind.MUSIC_ALBUM,
        provider: 'musicbrainz',
        externalId: 'not-a-uuid',
        title: 'Wrong ID',
      },
      {
        kind: HubMediaKind.BOOK,
        provider: 'openlibrary',
        externalId: 'OL600W',
        title: 'Tracking image',
        imageUrl: 'https://attacker.invalid/track.png',
      },
    ];

    for (const body of invalidBodies) {
      const response = await agent.post('/hub/requests').send(body);
      assert.strictEqual(response.status, 400);
    }

    const search = await agent.get(`/hub/search?query=${'x'.repeat(201)}`);
    assert.strictEqual(search.status, 400);
    const list = await agent.get('/hub/requests?take=251');
    assert.strictEqual(list.status, 400);
  });

  it('prevents non-admin request management actions', async () => {
    const hubRequest = await seedHubRequest('friend@seerr.dev', 'OL700W');
    const agent = await loginAs('friend@seerr.dev');

    for (const action of ['approve', 'retry', 'decline']) {
      const response = await agent.post(
        `/hub/requests/${hubRequest.id}/${action}`
      );
      assert.strictEqual(response.status, 403);
    }
  });
});

describe('Hub inbound rate limits', () => {
  it('uses standard headers, no legacy headers, and a neutral 429 response', async () => {
    const limitedApp = express();
    limitedApp.use((req, _res, next) => {
      req.user = { id: 999 } as User;
      next();
    });
    limitedApp.get(
      '/limited',
      createHubRateLimiter({ windowMs: 60_000, limit: 2 }),
      (_req, res) => res.json({ ok: true })
    );

    const first = await request(limitedApp).get('/limited');
    const second = await request(limitedApp).get('/limited');
    const blocked = await request(limitedApp).get('/limited');

    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    assert.ok(first.headers.ratelimit);
    assert.strictEqual(first.headers['x-ratelimit-limit'], undefined);
    assert.strictEqual(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);
    assert.deepStrictEqual(blocked.body, {
      code: 'RATE_LIMITED',
      message: 'Zu viele Hub-Anfragen. Bitte später erneut versuchen.',
    });
  });
});
