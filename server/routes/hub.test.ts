import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { HubMediaKind, HubRequestState } from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { HubUserProfile } from '@server/entity/HubUserProfile';
import { HubUserSignal } from '@server/entity/HubUserSignal';
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
  await getRepository(HubUserSignal).createQueryBuilder().delete().execute();
  await getRepository(HubUserProfile).createQueryBuilder().delete().execute();
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
    const artistSearch = await agent.get(
      '/hub/personalization/music/artists?query=x'
    );
    assert.strictEqual(artistSearch.status, 400);
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

  it('keeps unified activity, history, and reconciliation private', async () => {
    const own = await seedHubRequest('friend@seerr.dev', 'OL810W');
    const other = await seedHubRequest('admin@seerr.dev', 'OL820W');
    await getRepository(HubAuditEvent).save({
      request: own,
      action: 'state_changed',
      details: { from: 'pending', to: 'submitted', private: 'do-not-return' },
    });
    const agent = await loginAs('friend@seerr.dev');

    const activity = await agent.get('/hub/activity?kinds=book&take=20');
    assert.strictEqual(activity.status, 200);
    assert.deepStrictEqual(
      activity.body.results.map((item: { id: string }) => item.id),
      [`hub:${own.id}`]
    );
    assertNoSensitiveFields(activity.body);

    const history = await agent.get(`/hub/requests/${own.id}/history`);
    assert.strictEqual(history.status, 200);
    assert.deepStrictEqual(history.body.results[0].from, 'pending');
    assert.ok(!JSON.stringify(history.body).includes('do-not-return'));
    assert.strictEqual(
      (await agent.get(`/hub/requests/${other.id}/history`)).status,
      404
    );
    assert.strictEqual((await agent.get('/hub/reconciliation')).status, 403);
    assert.strictEqual((await agent.post('/hub/reconciliation')).status, 403);
  });

  it('returns only non-sensitive request defaults and quota state', async () => {
    const agent = await loginAs('friend@seerr.dev');
    const preferences = await agent.get('/hub/preferences');
    const quota = await agent.get('/hub/quota');
    assert.strictEqual(preferences.status, 200);
    assert.deepStrictEqual(Object.keys(preferences.body).sort(), [
      'bookFormats',
      'languages',
    ]);
    assert.strictEqual(quota.status, 200);
    assertNoSensitiveFields(quota.body);
  });

  it('claims a pending approval once and rejects concurrent stale actions', async () => {
    const hubRequest = await seedHubRequest('friend@seerr.dev', 'OL830W');
    const agent = await loginAs('admin@seerr.dev');
    const responses = await Promise.all([
      agent.post(`/hub/requests/${hubRequest.id}/approve`),
      agent.post(`/hub/requests/${hubRequest.id}/approve`),
    ]);
    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 409]
    );
    const auditEvents = await getRepository(HubAuditEvent).find({
      where: { request: { id: hubRequest.id } },
    });
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].action, 'failed');
  });

  it('declines only pending requests', async () => {
    const hubRequest = await seedHubRequest(
      'friend@seerr.dev',
      'OL840W',
      'previous failure'
    );
    const agent = await loginAs('admin@seerr.dev');
    const response = await agent
      .post(`/hub/requests/${hubRequest.id}/decline`)
      .send({ reason: 'No longer needed' });
    assert.strictEqual(response.status, 409);
    assert.equal(
      (await getRepository(HubRequest).findOneByOrFail({ id: hubRequest.id }))
        .state,
      HubRequestState.FAILED
    );
  });

  it('isolates profiles, feedback and the shared saved list per user', async () => {
    const friend = await loginAs('friend@seerr.dev');
    const admin = await loginAs('admin@seerr.dev');
    const item = {
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary',
      externalId: 'OL900W',
      title: 'Private saved book',
      saved: true,
      liked: true,
    };
    assert.strictEqual(
      (await friend.put('/hub/personalization/items').send(item)).status,
      200
    );
    await friend.put('/hub/personalization/profile').send({
      preferredGenres: ['fantasy'],
      musicGenres: ['metal', 'ambient'],
      musicArtists: [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          name: 'Private Band',
          type: 'Group',
        },
      ],
    });

    const friendSaved = await friend.get('/hub/saved');
    const adminSaved = await admin.get('/hub/saved');
    assert.strictEqual(friendSaved.body.results.length, 1);
    assert.strictEqual(adminSaved.body.results.length, 0);
    assert.deepStrictEqual(
      (await friend.get('/hub/personalization/profile')).body.preferredGenres,
      ['fantasy']
    );
    assert.deepStrictEqual(
      (await admin.get('/hub/personalization/profile')).body.preferredGenres,
      []
    );
    assert.deepStrictEqual(
      (await friend.get('/hub/personalization/profile')).body.musicGenres,
      ['metal', 'ambient']
    );
    assert.deepStrictEqual(
      (await admin.get('/hub/personalization/profile')).body.musicArtists,
      []
    );
  });

  it('resets only the current user and disables personalization', async () => {
    const friend = await loginAs('friend@seerr.dev');
    await friend.put('/hub/personalization/items').send({
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary',
      externalId: 'OL901W',
      title: 'Saved',
      saved: true,
    });
    const reset = await friend.delete('/hub/personalization/data');
    assert.strictEqual(reset.status, 200);
    assert.strictEqual(reset.body.enabled, false);
    assert.deepStrictEqual(reset.body.musicGenres, []);
    assert.deepStrictEqual(reset.body.musicArtists, []);
    assert.deepStrictEqual((await friend.get('/hub/saved')).body.results, []);
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
