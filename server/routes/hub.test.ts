import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import RadarrAPI from '@server/api/servarr/radarr';
import {
  HubMediaKind,
  HubRequestFormat,
  HubRequestState,
} from '@server/constants/hub';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { HubUserProfile } from '@server/entity/HubUserProfile';
import { HubUserSignal } from '@server/entity/HubUserSignal';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import downloadTracker from '@server/lib/downloadtracker';
import {
  cleanupAcquisitionIssues,
  recordAcquisitionIssue,
} from '@server/lib/hub/acquisitionIssues';
import { createHubRateLimiter } from '@server/lib/hub/rateLimit';
import {
  persistServarrHistoryIssues,
  persistServarrQueueIssues,
} from '@server/lib/hub/servarrIssueCollector';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import yaml from 'js-yaml';
import request from 'supertest';
import { IsNull } from 'typeorm';
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
  await getRepository(HubAcquisitionIssue)
    .createQueryBuilder()
    .delete()
    .execute();
  await getRepository(MediaRequest).createQueryBuilder().delete().execute();
  await getRepository(Media).createQueryBuilder().delete().execute();
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
  errorMessage: string | null = null,
  options: {
    kind?: HubMediaKind;
    formats?: HubRequestFormat[];
  } = {}
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
      kind: options.kind ?? HubMediaKind.BOOK,
      provider:
        options.kind && options.kind !== HubMediaKind.BOOK
          ? 'musicbrainz'
          : 'openlibrary',
      externalId,
      title: `Book ${externalId}`,
      formats: options.formats,
      state: errorMessage ? HubRequestState.FAILED : HubRequestState.PENDING,
      points: 1,
      requestedBy: user,
      idempotencyKey: `private-key-${externalId}`,
      errorMessage,
    })
  );
};

const seedVideoRequest = async (
  email: string,
  type: MediaType,
  tmdbId: number
) => {
  const requestedBy = await getRepository(User).findOneOrFail({
    where: { email },
  });
  const media = await getRepository(Media).save(
    new Media({
      mediaType: type,
      tmdbId,
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
    })
  );
  return getRepository(MediaRequest).save(
    new MediaRequest({
      type,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy,
      is4k: false,
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

  it('lets request viewers read sanitized foreign Hub history', async () => {
    const foreign = await seedHubRequest('admin@seerr.dev', 'OL-VIEW-HISTORY');
    const userRepository = getRepository(User);
    const friend = await userRepository.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const originalPermissions = friend.permissions;
    const agent = await loginAs('friend@seerr.dev');
    assert.strictEqual(
      (await agent.get(`/hub/requests/${foreign.id}/history`)).status,
      404
    );
    friend.permissions = Permission.REQUEST_VIEW;
    await userRepository.save(friend);
    try {
      const response = await agent.get(`/hub/requests/${foreign.id}/history`);
      assert.strictEqual(response.status, 200);
      assertNoSensitiveFields(response.body);
    } finally {
      friend.permissions = originalPermissions;
      await userRepository.save(friend);
    }
  });

  it('merges every request category and filters book formats', async () => {
    await seedVideoRequest('friend@seerr.dev', MediaType.MOVIE, 101);
    await seedVideoRequest('friend@seerr.dev', MediaType.TV, 202);
    await seedHubRequest('friend@seerr.dev', 'artist-id', null, {
      kind: HubMediaKind.MUSIC_ARTIST,
    });
    await seedHubRequest('friend@seerr.dev', 'album-id', null, {
      kind: HubMediaKind.MUSIC_ALBUM,
    });
    await seedHubRequest('friend@seerr.dev', 'OL910W', null, {
      formats: [HubRequestFormat.EBOOK],
    });
    await seedHubRequest('friend@seerr.dev', 'OL911W', null, {
      formats: [HubRequestFormat.AUDIOBOOK],
    });
    const agent = await loginAs('friend@seerr.dev');

    const activity = await agent.get('/hub/activity?take=20');
    assert.strictEqual(activity.status, 200);
    assert.deepStrictEqual(
      new Set(
        activity.body.results.map((item: { kind: HubMediaKind }) => item.kind)
      ),
      new Set(Object.values(HubMediaKind))
    );
    assert.ok(
      activity.body.results.some(
        (item: { source: string; externalId: string }) =>
          item.source === 'seerr' && item.externalId === '101'
      )
    );

    const audiobooks = await agent.get(
      '/hub/activity?kinds=book&formats=audiobook&take=20'
    );
    assert.strictEqual(audiobooks.status, 200);
    assert.deepStrictEqual(
      audiobooks.body.results.map(
        (item: { formats: HubRequestFormat[] }) => item.formats
      ),
      [[HubRequestFormat.AUDIOBOOK]]
    );
  });

  it('returns a privacy-safe download queue with movie progress', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      303
    );
    videoRequest.media.serviceId = 1;
    videoRequest.media.externalServiceId = 303;
    await getRepository(Media).save(videoRequest.media);
    videoRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(MediaRequest).save(videoRequest);
    const otherRequest = await seedVideoRequest(
      'admin@seerr.dev',
      MediaType.MOVIE,
      404
    );
    otherRequest.media.serviceId = 1;
    otherRequest.media.externalServiceId = 404;
    await getRepository(Media).save(otherRequest.media);
    otherRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(MediaRequest).save(otherRequest);
    const originalMovieProgress = downloadTracker.getMovieProgress;
    downloadTracker.getMovieProgress = () => [
      {
        mediaType: MediaType.MOVIE,
        externalId: 303,
        size: 2_000,
        sizeLeft: 500,
        status: 'downloading',
        timeLeft: '00:05:00',
        estimatedCompletionTime: new Date('2026-07-18T20:00:00Z'),
        title: 'private.release.name',
        downloadId: 'private-download-id',
      },
    ];

    try {
      const agent = await loginAs('friend@seerr.dev');
      const activity = await agent.get('/hub/activity?take=20');
      assert.strictEqual(activity.status, 200);
      assert.strictEqual(activity.body.queue.length, 1);
      assert.strictEqual(activity.body.queue[0].id, `video:${videoRequest.id}`);
      assert.strictEqual(activity.body.queue[0].downloadProgress.progress, 75);
      assert.strictEqual(activity.body.results[0].state, 'downloading');
      assert.strictEqual(
        activity.body.results[0].downloadProgress.progress,
        75
      );
      assert.ok(
        !JSON.stringify(activity.body).includes('private.release.name')
      );
      assert.ok(!JSON.stringify(activity.body).includes('private-download-id'));
    } finally {
      downloadTracker.getMovieProgress = originalMovieProgress;
    }
  });

  it('reports exact Sonarr episode counts and Radarr release availability', async () => {
    const seriesRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1001
    );
    seriesRequest.media.serviceId = 1;
    seriesRequest.media.externalServiceId = 11;
    await getRepository(Media).save(seriesRequest.media);
    seriesRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(MediaRequest).save(seriesRequest);
    const movieRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1002
    );
    movieRequest.media.serviceId = 1;
    movieRequest.media.externalServiceId = 12;
    await getRepository(Media).save(movieRequest.media);
    movieRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(MediaRequest).save(movieRequest);
    const original = downloadTracker.getVideoSnapshot;
    const originalStatus = downloadTracker.getStatus;
    const now = new Date().toISOString();
    downloadTracker.getStatus = () => ({
      lastSuccessfulSyncAt: now,
      stale: false,
      updating: false,
      providers: { radarr: true, sonarr: true, sabnzbd: true },
      providerLastSuccessfulSyncAt: { radarr: now, sonarr: now },
      providerStale: { radarr: false, sonarr: false, sabnzbd: false },
    });
    downloadTracker.getVideoSnapshot = (mediaType) =>
      mediaType === MediaType.TV
        ? {
            availability: 'missing',
            waitingForRelease: false,
            requested: 74,
            imported: 0,
            queued: 0,
            failed: 0,
          }
        : {
            availability: 'missing',
            waitingForRelease: true,
            requested: 1,
            imported: 0,
            queued: 0,
            failed: 0,
          };
    try {
      const response = await (
        await loginAs('friend@seerr.dev')
      ).get('/hub/activity?take=20');
      assert.strictEqual(response.status, 200);
      const series = response.body.results.find(
        (item: { externalId: string }) => item.externalId === '1001'
      );
      const movie = response.body.results.find(
        (item: { externalId: string }) => item.externalId === '1002'
      );
      assert.deepStrictEqual(series.acquisition.counts, {
        requested: 74,
        queued: 0,
        imported: 0,
        failed: 0,
      });
      assert.ok(
        response.body.acquisitionQueue.groups.queued.some(
          (item: { id: string }) => item.id === `video:${seriesRequest.id}`
        )
      );
      assert.strictEqual(movie.acquisition.phase, 'waiting_for_release');
    } finally {
      downloadTracker.getVideoSnapshot = original;
      downloadTracker.getStatus = originalStatus;
    }
  });

  it('reports linked requests as unknown problems when tracker evidence is stale', async () => {
    const movieRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1003
    );
    movieRequest.media.serviceId = 1;
    movieRequest.media.externalServiceId = 13;
    await getRepository(Media).save(movieRequest.media);
    movieRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(MediaRequest).save(movieRequest);
    const originalStatus = downloadTracker.getStatus;
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    const originalProgress = downloadTracker.getMovieProgress;
    const now = new Date().toISOString();
    downloadTracker.getStatus = () => ({
      lastSuccessfulSyncAt: now,
      stale: false,
      updating: false,
      providers: { radarr: true, sonarr: true, sabnzbd: true },
      providerLastSuccessfulSyncAt: { radarr: now },
      providerStale: { radarr: false, sonarr: false, sabnzbd: false },
      serverLastSuccessfulSyncAt: { radarr: {}, sonarr: {} },
      serverStale: { radarr: {}, sonarr: {} },
    });
    downloadTracker.getVideoSnapshot = () => undefined;
    downloadTracker.getMovieProgress = () => [];
    try {
      const response = await (
        await loginAs('friend@seerr.dev')
      ).get('/hub/activity?take=20');
      const item = response.body.results.find(
        (result: { externalId: string }) => result.externalId === '1003'
      );
      assert.strictEqual(item.acquisition.phase, 'unknown');
      assert.strictEqual(item.acquisition.health, 'stale');
      assert.strictEqual(item.acquisition.stale, true);
      assert.ok(
        response.body.acquisitionQueue.groups.problems.some(
          (problem: { id: string }) => problem.id === `video:${movieRequest.id}`
        )
      );
      assert.strictEqual(
        response.body.acquisitionQueue.summary.waitingForRelease,
        0
      );
    } finally {
      downloadTracker.getStatus = originalStatus;
      downloadTracker.getVideoSnapshot = originalSnapshot;
      downloadTracker.getMovieProgress = originalProgress;
    }
  });

  it('scopes tracker freshness to the relevant video provider', async () => {
    const movie = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1004
    );
    const series = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1005
    );
    for (const [request, externalServiceId] of [
      [movie, 14],
      [series, 15],
    ] as const) {
      request.status = MediaRequestStatus.APPROVED;
      request.media.serviceId = 1;
      request.media.externalServiceId = externalServiceId;
      await getRepository(Media).save(request.media);
      await getRepository(MediaRequest).save(request);
    }
    const originalStatus = downloadTracker.getStatus;
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    const now = new Date().toISOString();
    downloadTracker.getVideoSnapshot = () => ({
      availability: 'missing',
      waitingForRelease: false,
      requested: 1,
      imported: 0,
      queued: 0,
      failed: 0,
    });
    try {
      const assertFreshness = async (providerStale: {
        radarr: boolean;
        sonarr: boolean;
        sabnzbd: boolean;
      }) => {
        downloadTracker.getStatus = () => ({
          lastSuccessfulSyncAt: now,
          stale: true,
          updating: false,
          providers: {
            radarr: !providerStale.radarr,
            sonarr: !providerStale.sonarr,
            sabnzbd: true,
          },
          providerLastSuccessfulSyncAt: { radarr: now, sonarr: now },
          providerStale,
        });
        const response = await (
          await loginAs('friend@seerr.dev')
        ).get('/hub/activity?take=20');
        return Object.fromEntries(
          response.body.results.map(
            (item: { externalId: string; acquisition: { stale: boolean } }) => [
              item.externalId,
              item.acquisition.stale,
            ]
          )
        );
      };
      assert.deepStrictEqual(
        await assertFreshness({
          radarr: true,
          sonarr: false,
          sabnzbd: false,
        }),
        { '1004': true, '1005': false }
      );
      assert.deepStrictEqual(
        await assertFreshness({
          radarr: false,
          sonarr: true,
          sabnzbd: false,
        }),
        { '1004': false, '1005': true }
      );
    } finally {
      downloadTracker.getStatus = originalStatus;
      downloadTracker.getVideoSnapshot = originalSnapshot;
    }
  });

  it('scopes tracker freshness to each Radarr and Sonarr server', async () => {
    const requests = await Promise.all([
      seedVideoRequest('friend@seerr.dev', MediaType.MOVIE, 1010),
      seedVideoRequest('friend@seerr.dev', MediaType.MOVIE, 1011),
      seedVideoRequest('friend@seerr.dev', MediaType.TV, 1012),
      seedVideoRequest('friend@seerr.dev', MediaType.TV, 1013),
    ]);
    for (const [index, request] of requests.entries()) {
      request.status = MediaRequestStatus.APPROVED;
      request.media.serviceId = index % 2 === 0 ? 1 : 2;
      request.media.externalServiceId = 20 + index;
      await getRepository(Media).save(request.media);
      await getRepository(MediaRequest).save(request);
    }
    const originalStatus = downloadTracker.getStatus;
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    const now = new Date().toISOString();
    downloadTracker.getStatus = () => ({
      lastSuccessfulSyncAt: now,
      stale: true,
      updating: false,
      providers: { radarr: false, sonarr: false, sabnzbd: true },
      providerLastSuccessfulSyncAt: { radarr: now, sonarr: now },
      providerStale: { radarr: true, sonarr: true, sabnzbd: false },
      serverLastSuccessfulSyncAt: {
        radarr: { 1: now, 2: now },
        sonarr: { 1: now, 2: now },
      },
      serverStale: {
        radarr: { 1: false, 2: true },
        sonarr: { 1: false, 2: true },
      },
    });
    downloadTracker.getVideoSnapshot = () => ({
      availability: 'missing',
      waitingForRelease: false,
      requested: 1,
      imported: 0,
      queued: 0,
      failed: 0,
    });
    try {
      const response = await (
        await loginAs('friend@seerr.dev')
      ).get('/hub/activity?take=20');
      const staleByExternalId = Object.fromEntries(
        response.body.results.map(
          (item: { externalId: string; acquisition: { stale: boolean } }) => [
            item.externalId,
            item.acquisition.stale,
          ]
        )
      );
      assert.deepStrictEqual(staleByExternalId, {
        '1010': false,
        '1011': true,
        '1012': false,
        '1013': true,
      });
    } finally {
      downloadTracker.getStatus = originalStatus;
      downloadTracker.getVideoSnapshot = originalSnapshot;
    }
  });

  it('invalidates all tracker freshness when the tracker is reset', async () => {
    await downloadTracker.resetDownloadTracker();
    const status = downloadTracker.getStatus();
    assert.strictEqual(status.lastSuccessfulSyncAt, undefined);
    assert.deepStrictEqual(status.providerStale, {
      radarr: true,
      sonarr: true,
      sabnzbd: true,
    });
    assert.deepStrictEqual(status.serverStale, { radarr: {}, sonarr: {} });
  });

  it('uses a known future movie release date as waiting-for-release evidence', async () => {
    const movieRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1006
    );
    movieRequest.media.serviceId = 1;
    movieRequest.media.externalServiceId = 16;
    movieRequest.status = MediaRequestStatus.APPROVED;
    await getRepository(Media).save(movieRequest.media);
    await getRepository(MediaRequest).save(movieRequest);
    type ExternalGet = <T>(endpoint: string) => Promise<T>;
    const externalPrototype = ExternalAPI.prototype as unknown as {
      get: ExternalGet;
    };
    const originalGet = externalPrototype.get;
    const originalStatus = downloadTracker.getStatus;
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    externalPrototype.get = async <T>() =>
      ({
        id: 1006,
        title: 'Future movie',
        release_date: '2999-01-01',
        videos: { results: [{ type: 'Trailer' }] },
      }) as T;
    downloadTracker.getStatus = () => ({
      stale: false,
      updating: false,
      providers: { radarr: true, sonarr: true, sabnzbd: true },
      providerLastSuccessfulSyncAt: { radarr: new Date().toISOString() },
      providerStale: { radarr: false, sonarr: false, sabnzbd: false },
    });
    downloadTracker.getVideoSnapshot = () => undefined;
    try {
      const response = await (
        await loginAs('friend@seerr.dev')
      ).get('/hub/activity?take=20');
      assert.strictEqual(
        response.body.results.find(
          (item: { externalId: string }) => item.externalId === '1006'
        ).acquisition.phase,
        'waiting_for_release'
      );
    } finally {
      externalPrototype.get = originalGet;
      downloadTracker.getStatus = originalStatus;
      downloadTracker.getVideoSnapshot = originalSnapshot;
    }
  });

  it('includes submitted searches in the queued acquisition group', async () => {
    const pending = await seedHubRequest('friend@seerr.dev', 'OL-SEARCHING');
    const response = await (
      await loginAs('friend@seerr.dev')
    ).get('/hub/activity?take=20');
    assert.ok(
      response.body.acquisitionQueue.groups.queued.some(
        (item: { id: string; acquisition: { phase: string } }) =>
          item.id === `hub:${pending.id}` &&
          item.acquisition.phase === 'searching'
      )
    );
  });

  it('scopes Sonarr counts and queue parts to the seasons in each request', async () => {
    const own = await seedVideoRequest('friend@seerr.dev', MediaType.TV, 1201);
    own.media.serviceId = 1;
    own.media.externalServiceId = 77;
    await getRepository(Media).save(own.media);
    own.status = MediaRequestStatus.APPROVED;
    own.seasons = [
      new SeasonRequest({
        seasonNumber: 1,
        status: MediaRequestStatus.APPROVED,
      }),
    ];
    await getRepository(MediaRequest).save(own);
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    const originalProgress = downloadTracker.getSeriesProgress;
    downloadTracker.getVideoSnapshot = () => ({
      availability: 'partial',
      waitingForRelease: false,
      requested: 20,
      imported: 9,
      queued: 2,
      failed: 1,
      seasons: {
        1: { requested: 10, imported: 9, queued: 1, failed: 0 },
        2: { requested: 10, imported: 0, queued: 1, failed: 1 },
      },
    });
    downloadTracker.getSeriesProgress = () => [
      {
        mediaType: MediaType.TV,
        externalId: 77,
        size: 1_000,
        sizeLeft: 500,
        status: 'downloading',
        timeLeft: '00:05:00',
        estimatedCompletionTime: new Date(),
        title: 'private-season-one',
        downloadId: 'season-one',
        source: 'sonarr',
        episode: {
          seasonNumber: 1,
          episodeNumber: 10,
          absoluteEpisodeNumber: 10,
          id: 10,
        },
      },
      {
        mediaType: MediaType.TV,
        externalId: 77,
        size: 1_000,
        sizeLeft: 900,
        status: 'warning',
        timeLeft: '',
        estimatedCompletionTime: new Date(),
        title: 'private-season-two',
        downloadId: 'season-two',
        source: 'sonarr',
        episode: {
          seasonNumber: 2,
          episodeNumber: 1,
          absoluteEpisodeNumber: 11,
          id: 11,
        },
      },
    ];
    try {
      const response = await (
        await loginAs('friend@seerr.dev')
      ).get('/hub/activity?take=20');
      const item = response.body.results.find(
        (result: { externalId: string }) => result.externalId === '1201'
      );
      assert.deepStrictEqual(item.acquisition.counts, {
        requested: 10,
        queued: 1,
        imported: 9,
        failed: 0,
      });
      assert.deepStrictEqual(item.acquisition.parts[0].episodes, [
        { seasonNumber: 1, episodeNumber: 10 },
      ]);
      assert.ok(!JSON.stringify(item).includes('private-season-two'));
    } finally {
      downloadTracker.getVideoSnapshot = originalSnapshot;
      downloadTracker.getSeriesProgress = originalProgress;
    }
  });

  it('uses canonical separate issue keys for each failed episode', async () => {
    const request = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1202
    );
    request.status = MediaRequestStatus.APPROVED;
    request.media.serviceId = 1;
    request.media.externalServiceId = 78;
    request.seasons = [
      new SeasonRequest({
        seasonNumber: 0,
        status: MediaRequestStatus.APPROVED,
      }),
      new SeasonRequest({
        seasonNumber: 1,
        status: MediaRequestStatus.APPROVED,
      }),
    ];
    await getRepository(Media).save(request.media);
    await getRepository(MediaRequest).save(request);
    const originalStatus = downloadTracker.getStatus;
    const originalSnapshot = downloadTracker.getVideoSnapshot;
    const originalProgress = downloadTracker.getSeriesProgress;
    const now = new Date().toISOString();
    const failures = [
      { seasonNumber: 0, episodeNumber: 1, id: 1 },
      { seasonNumber: 1, episodeNumber: 3, id: 3 },
    ].map((episode) => ({
      mediaType: MediaType.TV,
      externalId: 78,
      size: 100,
      sizeLeft: 50,
      status: 'warning',
      timeLeft: '',
      estimatedCompletionTime: new Date(),
      title: '',
      downloadId: 'failed-pack',
      source: 'sonarr' as const,
      episode: { ...episode, absoluteEpisodeNumber: episode.id },
    }));
    downloadTracker.getStatus = () => ({
      lastSuccessfulSyncAt: now,
      stale: false,
      updating: false,
      providers: { radarr: true, sonarr: true, sabnzbd: true },
      providerLastSuccessfulSyncAt: { sonarr: now },
      providerStale: { radarr: false, sonarr: false, sabnzbd: false },
      serverLastSuccessfulSyncAt: { radarr: {}, sonarr: { 1: now } },
      serverStale: { radarr: {}, sonarr: { 1: false } },
    });
    downloadTracker.getVideoSnapshot = () => ({
      availability: 'missing',
      waitingForRelease: false,
      requested: 2,
      imported: 0,
      queued: 2,
      failed: 2,
    });
    downloadTracker.getSeriesProgress = () => failures;
    try {
      await (await loginAs('friend@seerr.dev')).get('/hub/activity?take=20');
      await persistServarrQueueIssues('sonarr', 1, failures);
      const issues = await getRepository(HubAcquisitionIssue).findBy({
        requestSource: 'seerr',
        requestId: request.id,
        resolvedAt: IsNull(),
      });
      assert.deepStrictEqual(issues.map((issue) => issue.partKey).sort(), [
        'S00E01',
        'S01E03',
      ]);
    } finally {
      downloadTracker.getStatus = originalStatus;
      downloadTracker.getVideoSnapshot = originalSnapshot;
      downloadTracker.getSeriesProgress = originalProgress;
    }
  });

  it('keeps a Hub acquisition failed and its issue open when retry submission fails', async () => {
    const failed = await seedHubRequest(
      'admin@seerr.dev',
      'OL1301W',
      'private provider failure'
    );
    const admin = await loginAs('admin@seerr.dev');
    const activity = await admin.get('/hub/activity?take=20');
    const issue = activity.body.acquisitionQueue.issues.find(
      (item: { id: string }) => item.id.startsWith(`hub:${failed.id}:`)
    ).acquisition.issue;
    const retry = await admin.post(`/hub/acquisition/issues/${issue.id}/retry`);
    assert.strictEqual(retry.status, 409);
    assert.strictEqual(
      (await getRepository(HubRequest).findOneByOrFail({ id: failed.id }))
        .state,
      HubRequestState.FAILED
    );
    assert.equal(
      (
        await getRepository(HubAcquisitionIssue).findOneByOrFail({
          id: issue.id,
        })
      ).resolvedAt,
      null
    );
    const providerRequest = await seedHubRequest('admin@seerr.dev', 'OL1302W');
    providerRequest.state = HubRequestState.DOWNLOADING;
    await getRepository(HubRequest).save(providerRequest);
    const providerIssue = await recordAcquisitionIssue({
      requestSource: 'hub',
      requestId: providerRequest.id,
      kind: HubMediaKind.BOOK,
      externalId: providerRequest.externalId,
      is4k: false,
      reasonCode: 'provider_failed',
      requestedBy: providerRequest.requestedBy,
    });
    assert.strictEqual(providerIssue.retryable, false);
    assert.strictEqual(
      (await admin.post(`/hub/acquisition/issues/${providerIssue.id}/retry`))
        .status,
      409
    );
    assert.strictEqual(
      (
        await getRepository(HubRequest).findOneByOrFail({
          id: providerRequest.id,
        })
      ).state,
      HubRequestState.DOWNLOADING
    );
  });

  it('isolates acquisition issue actions from users without management permission', async () => {
    const ownRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      707
    );
    const foreignRequest = await seedVideoRequest(
      'admin@seerr.dev',
      MediaType.MOVIE,
      808
    );
    const issueRepository = getRepository(HubAcquisitionIssue);
    const ownIssue = await issueRepository.save(
      issueRepository.create({
        requestSource: 'seerr',
        requestId: ownRequest.id,
        kind: MediaType.MOVIE,
        externalId: '707',
        is4k: false,
        partKey: '',
        reasonCode: 'download_failed',
        message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
        retryable: true,
        requestedBy: ownRequest.requestedBy,
        lastSeenAt: new Date(),
      })
    );
    const foreignIssue = await issueRepository.save(
      issueRepository.create({
        requestSource: 'seerr',
        requestId: foreignRequest.id,
        kind: MediaType.MOVIE,
        externalId: '808',
        is4k: false,
        partKey: '',
        reasonCode: 'download_failed',
        message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
        retryable: true,
        requestedBy: foreignRequest.requestedBy,
        lastSeenAt: new Date(),
      })
    );
    const agent = await loginAs('friend@seerr.dev');
    const acknowledged = await agent.post(
      `/hub/acquisition/issues/${ownIssue.id}/acknowledge`
    );
    assert.strictEqual(acknowledged.status, 403);
    assert.strictEqual(
      (
        await agent.post(
          `/hub/acquisition/issues/${foreignIssue.id}/acknowledge`
        )
      ).status,
      403
    );
    assert.strictEqual(
      (await agent.post(`/hub/acquisition/issues/${ownIssue.id}/retry`)).status,
      403
    );
    const admin = await loginAs('admin@seerr.dev');
    const managed = await admin.post(
      `/hub/acquisition/issues/${foreignIssue.id}/acknowledge`
    );
    assert.strictEqual(managed.status, 200);
    assert.strictEqual(managed.body.acknowledged, true);
  });

  it('keeps acknowledge from reopening a concurrently claimed retry', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      809
    );
    videoRequest.status = MediaRequestStatus.APPROVED;
    videoRequest.media.serviceId = 91;
    videoRequest.media.externalServiceId = 92;
    await getRepository(Media).save(videoRequest.media);
    await getRepository(MediaRequest).save(videoRequest);
    const repository = getRepository(HubAcquisitionIssue);
    const issue = await repository.save(
      repository.create({
        requestSource: 'seerr',
        requestId: videoRequest.id,
        kind: MediaType.MOVIE,
        externalId: '809',
        is4k: false,
        partKey: '',
        reasonCode: 'download_failed',
        message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
        retryable: true,
        requestedBy: videoRequest.requestedBy,
        lastSeenAt: new Date(),
      })
    );
    const settings = getSettings();
    const originalServers = settings.radarr;
    const originalRetry = RadarrAPI.prototype.retryMovieSearch;
    settings.radarr = [
      {
        id: 91,
        name: 'Test Radarr',
        hostname: 'localhost',
        port: 7878,
        apiKey: 'test',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'Any',
        activeDirectory: '/movies',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        minimumAvailability: 'released',
      },
    ];
    let commands = 0;
    let signalProviderStarted!: () => void;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    RadarrAPI.prototype.retryMovieSearch = async () => {
      commands += 1;
      signalProviderStarted();
      await providerReleased;
    };
    try {
      const admin = await loginAs('admin@seerr.dev');
      const acceptedRetry = admin
        .post(`/hub/acquisition/issues/${issue.id}/retry`)
        .then((response) => response);
      await providerStarted;
      const [acknowledged, competingRetry] = await Promise.all([
        admin.post(`/hub/acquisition/issues/${issue.id}/acknowledge`),
        admin.post(`/hub/acquisition/issues/${issue.id}/retry`),
      ]);
      assert.strictEqual(acknowledged.status, 404);
      assert.strictEqual(competingRetry.status, 409);
      releaseProvider();
      assert.strictEqual((await acceptedRetry).status, 200);
      assert.strictEqual(
        (await admin.post(`/hub/acquisition/issues/${issue.id}/retry`)).status,
        409
      );
      assert.strictEqual(commands, 1);
    } finally {
      settings.radarr = originalServers;
      RadarrAPI.prototype.retryMovieSearch = originalRetry;
    }
  });

  it('removes resolved acquisition issues after seven days', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      909
    );
    const repository = getRepository(HubAcquisitionIssue);
    await repository.save(
      repository.create({
        requestSource: 'seerr',
        requestId: videoRequest.id,
        kind: MediaType.MOVIE,
        externalId: '909',
        is4k: false,
        partKey: '',
        reasonCode: 'download_failed',
        message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
        retryable: true,
        requestedBy: videoRequest.requestedBy,
        lastSeenAt: new Date('2026-07-01T00:00:00Z'),
        resolvedAt: new Date('2026-07-01T00:00:00Z'),
      })
    );
    assert.strictEqual(
      await cleanupAcquisitionIssues(new Date('2026-07-09T00:00:01Z')),
      1
    );
  });

  it('returns only the current users privacy-safe recently resolved issues', async () => {
    const ownRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1101
    );
    const foreignRequest = await seedVideoRequest(
      'admin@seerr.dev',
      MediaType.TV,
      1102
    );
    const repository = getRepository(HubAcquisitionIssue);
    const resolvedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    for (const request of [ownRequest, foreignRequest]) {
      await repository.save(
        repository.create({
          requestSource: 'seerr',
          requestId: request.id,
          kind: request.type,
          externalId: String(request.media.tmdbId),
          is4k: false,
          partKey: 'S01E01',
          reasonCode: 'download_failed',
          message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
          retryable: true,
          requestedBy: request.requestedBy,
          acknowledgedAt: resolvedAt,
          resolvedAt,
          lastSeenAt: resolvedAt,
        })
      );
    }
    const response = await (
      await loginAs('friend@seerr.dev')
    ).get('/hub/activity?take=20');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.acquisitionQueue.recentIssues.length, 1);
    assert.deepStrictEqual(
      Object.keys(response.body.acquisitionQueue.recentIssues[0]).sort(),
      [
        'acknowledged',
        'kind',
        'message',
        'reasonCode',
        'requestId',
        'resolvedAt',
        'source',
        'title',
      ]
    );
    assert.strictEqual(
      response.body.acquisitionQueue.recentIssues[0].requestId,
      ownRequest.id
    );
    assert.strictEqual(
      response.body.acquisitionQueue.recentIssues[0].acknowledged,
      true
    );
    assertNoSensitiveFields(response.body.acquisitionQueue.recentIssues);
    assert.ok(!JSON.stringify(response.body).includes('S01E01'));
  });

  it('keeps every persisted open issue visible beyond the former silent cap', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1199
    );
    const repository = getRepository(HubAcquisitionIssue);
    await repository.save(
      Array.from({ length: 205 }, (_, index) =>
        repository.create({
          requestSource: 'seerr',
          requestId: videoRequest.id,
          kind: MediaType.TV,
          externalId: '1199',
          is4k: false,
          partKey: `S01E${String(index + 1).padStart(3, '0')}`,
          reasonCode: 'download_failed',
          message: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
          retryable: true,
          requestedBy: videoRequest.requestedBy,
          lastSeenAt: new Date(),
        })
      )
    );
    const response = await (
      await loginAs('friend@seerr.dev')
    ).get('/hub/activity?take=20');
    assert.strictEqual(response.body.acquisitionQueue.issues.length, 205);
    assert.strictEqual(response.body.acquisitionQueue.summary.failed, 205);
  });

  it('keeps episode issues isolated and follows the latest Sonarr history event', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1401
    );
    videoRequest.media.serviceId = 1;
    videoRequest.media.externalServiceId = 88;
    await getRepository(Media).save(videoRequest.media);
    videoRequest.status = MediaRequestStatus.APPROVED;
    videoRequest.seasons = [
      new SeasonRequest({
        seasonNumber: 1,
        status: MediaRequestStatus.APPROVED,
      }),
    ];
    await getRepository(MediaRequest).save(videoRequest);
    const issue = await recordAcquisitionIssue({
      requestSource: 'seerr',
      requestId: videoRequest.id,
      kind: MediaType.TV,
      externalId: '1401',
      is4k: false,
      partKey: 'S01E02',
      reasonCode: 'download_failed',
      requestedBy: videoRequest.requestedBy,
    });
    issue.acknowledgedAt = new Date();
    await getRepository(HubAcquisitionIssue).save(issue);
    await persistServarrQueueIssues('sonarr', 1, [
      {
        mediaType: MediaType.TV,
        externalId: 88,
        size: 100,
        sizeLeft: 50,
        status: 'downloading',
        timeLeft: '',
        estimatedCompletionTime: new Date(),
        title: '',
        downloadId: 'healthy-e03',
        source: 'sonarr',
        episode: {
          seasonNumber: 1,
          episodeNumber: 3,
          absoluteEpisodeNumber: 3,
          id: 3,
        },
      },
    ]);
    let persisted = await getRepository(HubAcquisitionIssue).findOneByOrFail({
      id: issue.id,
    });
    assert.equal(persisted.resolvedAt, null);
    assert.ok(persisted.acknowledgedAt);
    const base = Date.now() - 60_000;
    await persistServarrHistoryIssues('sonarr', 1, [
      {
        id: 1,
        seriesId: 88,
        episodeId: 2,
        eventType: 'downloadFailed',
        date: new Date(base).toISOString(),
        episode: { seasonNumber: 1, episodeNumber: 2 },
      },
      {
        id: 2,
        seriesId: 88,
        episodeId: 2,
        eventType: 'downloadFolderImported',
        date: new Date(base + 1_000).toISOString(),
        episode: { seasonNumber: 1, episodeNumber: 2 },
      },
    ]);
    persisted = await getRepository(HubAcquisitionIssue).findOneByOrFail({
      id: issue.id,
    });
    assert.ok(persisted.resolvedAt);
    await persistServarrHistoryIssues('sonarr', 1, [
      {
        id: 2,
        seriesId: 88,
        episodeId: 2,
        eventType: 'downloadFolderImported',
        date: new Date(base + 1_000).toISOString(),
        episode: { seasonNumber: 1, episodeNumber: 2 },
      },
      {
        id: 3,
        seriesId: 88,
        episodeId: 2,
        eventType: 'downloadFailed',
        date: new Date(base + 2_000).toISOString(),
        episode: { seasonNumber: 1, episodeNumber: 2 },
      },
    ]);
    persisted = await getRepository(HubAcquisitionIssue).findOneByOrFail({
      id: issue.id,
    });
    assert.equal(persisted.resolvedAt, null);
    assert.equal(persisted.acknowledgedAt, null);
  });

  it('persists and resolves Sonarr special-season episode issues', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1402
    );
    videoRequest.media.serviceId = 1;
    videoRequest.media.externalServiceId = 89;
    await getRepository(Media).save(videoRequest.media);
    videoRequest.status = MediaRequestStatus.APPROVED;
    videoRequest.seasons = [
      new SeasonRequest({
        seasonNumber: 0,
        status: MediaRequestStatus.APPROVED,
      }),
    ];
    await getRepository(MediaRequest).save(videoRequest);
    const failedAt = new Date(Date.now() - 2_000);
    await persistServarrHistoryIssues('sonarr', 1, [
      {
        id: 10,
        seriesId: 89,
        episodeId: 1,
        eventType: 'downloadFailed',
        date: failedAt.toISOString(),
        episode: { seasonNumber: 0, episodeNumber: 1 },
      },
    ]);
    const repository = getRepository(HubAcquisitionIssue);
    const issue = await repository.findOneByOrFail({
      requestSource: 'seerr',
      requestId: videoRequest.id,
      partKey: 'S00E01',
    });
    assert.equal(issue.resolvedAt, null);
    await recordAcquisitionIssue({
      requestSource: 'seerr',
      requestId: videoRequest.id,
      kind: MediaType.TV,
      externalId: '1402',
      is4k: false,
      partKey: 'S01E03',
      reasonCode: 'download_failed',
      requestedBy: videoRequest.requestedBy,
    });
    const activity = await (
      await loginAs('friend@seerr.dev')
    ).get('/hub/activity?take=20');
    assert.deepStrictEqual(
      activity.body.acquisitionQueue.issues
        .map(
          (item: {
            acquisition: {
              issue: {
                episodes: { seasonNumber: number; episodeNumber: number }[];
              };
            };
          }) => item.acquisition.issue.episodes
        )
        .sort((a: unknown[], b: unknown[]) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b))
        ),
      [
        [{ seasonNumber: 0, episodeNumber: 1 }],
        [{ seasonNumber: 1, episodeNumber: 3 }],
      ]
    );
    await persistServarrHistoryIssues('sonarr', 1, [
      {
        id: 11,
        seriesId: 89,
        episodeId: 1,
        eventType: 'downloadFolderImported',
        date: new Date(failedAt.getTime() + 1_000).toISOString(),
        data: { seasonNumber: '0', episodeNumber: '1' },
      },
    ]);
    assert.ok((await repository.findOneByOrFail({ id: issue.id })).resolvedAt);
  });

  it('resolves an open issue from history after its request completed', async () => {
    const request = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1403
    );
    request.media.serviceId = 1;
    request.media.externalServiceId = 90;
    request.status = MediaRequestStatus.APPROVED;
    request.seasons = [
      new SeasonRequest({
        seasonNumber: 1,
        status: MediaRequestStatus.APPROVED,
      }),
    ];
    await getRepository(Media).save(request.media);
    await getRepository(MediaRequest).save(request);
    const issue = await recordAcquisitionIssue({
      requestSource: 'seerr',
      requestId: request.id,
      kind: MediaType.TV,
      externalId: '1403',
      is4k: false,
      partKey: 'S01E01',
      reasonCode: 'download_failed',
      requestedBy: request.requestedBy,
    });
    request.status = MediaRequestStatus.COMPLETED;
    await getRepository(MediaRequest).save(request);
    await persistServarrHistoryIssues('sonarr', 1, [
      {
        id: 12,
        seriesId: 90,
        episodeId: 1,
        eventType: 'downloadFolderImported',
        date: new Date().toISOString(),
        episode: { seasonNumber: 1, episodeNumber: 1 },
      },
    ]);
    assert.ok(
      (
        await getRepository(HubAcquisitionIssue).findOneByOrFail({
          id: issue.id,
        })
      ).resolvedAt
    );
  });

  it('records concurrent observations once and cleans orphaned issues', async () => {
    const videoRequest = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.MOVIE,
      1501
    );
    const input = {
      requestSource: 'seerr' as const,
      requestId: videoRequest.id,
      kind: MediaType.MOVIE,
      externalId: '1501',
      is4k: false,
      partKey: '',
      reasonCode: 'download_failed',
      requestedBy: videoRequest.requestedBy,
    };
    await Promise.all([
      recordAcquisitionIssue(input),
      recordAcquisitionIssue(input),
    ]);
    assert.strictEqual(
      await getRepository(HubAcquisitionIssue).countBy({
        requestSource: 'seerr',
        requestId: videoRequest.id,
      }),
      1
    );
    await getRepository(MediaRequest).remove(videoRequest);
    await cleanupAcquisitionIssues();
    assert.strictEqual(
      await getRepository(HubAcquisitionIssue).countBy({
        requestSource: 'seerr',
        requestId: videoRequest.id,
      }),
      0
    );
  });

  it('keeps only the latest open reason for each acquisition part', async () => {
    const request = await seedVideoRequest(
      'friend@seerr.dev',
      MediaType.TV,
      1502
    );
    const base = {
      requestSource: 'seerr' as const,
      requestId: request.id,
      kind: MediaType.TV,
      externalId: '1502',
      is4k: false,
      partKey: 'S01E01',
      requestedBy: request.requestedBy,
    };
    await recordAcquisitionIssue({ ...base, reasonCode: 'provider_warning' });
    await recordAcquisitionIssue({ ...base, reasonCode: 'download_failed' });
    const repository = getRepository(HubAcquisitionIssue);
    assert.strictEqual(
      await repository.countBy({
        requestSource: 'seerr',
        requestId: request.id,
        partKey: 'S01E01',
        resolvedAt: IsNull(),
      }),
      1
    );
    assert.strictEqual(
      (
        await repository.findOneByOrFail({
          requestSource: 'seerr',
          requestId: request.id,
          partKey: 'S01E01',
          resolvedAt: IsNull(),
        })
      ).reasonCode,
      'download_failed'
    );
  });

  it('keeps deep request pages chronological while including an older active queue item', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const base = Date.now();
    const requests = Array.from(
      { length: 125 },
      (_, index) =>
        new HubRequest({
          kind: HubMediaKind.BOOK,
          provider: 'openlibrary',
          externalId: `OL${2000 + index}W`,
          title: `Paged book ${index}`,
          state:
            index === 124
              ? HubRequestState.DOWNLOADING
              : HubRequestState.PENDING,
          points: 1,
          requestedBy,
          idempotencyKey: `paging-${index}`,
          createdAt: new Date(base - index * 1_000),
          updatedAt: new Date(base - index * 1_000),
        })
    );
    await getRepository(HubRequest).save(requests);
    const response = await (
      await loginAs('friend@seerr.dev')
    ).get('/hub/activity?take=20&skip=100');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results.length, 20);
    assert.deepStrictEqual(
      response.body.results.map((item: { title: string }) => item.title),
      Array.from({ length: 20 }, (_, index) => `Paged book ${100 + index}`)
    );
    assert.ok(
      response.body.acquisitionQueue.groups.downloading.some(
        (item: { title: string }) => item.title === 'Paged book 124'
      )
    );
  });

  it('continues sparse filtered results with the bounded raw scan cursor', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const base = Date.now();
    await getRepository(HubRequest).save(
      Array.from(
        { length: 141 },
        (_, index) =>
          new HubRequest({
            kind: index === 140 ? HubMediaKind.MUSIC_ALBUM : HubMediaKind.BOOK,
            provider: index === 140 ? 'musicbrainz' : 'openlibrary',
            externalId:
              index === 140
                ? '00000000-0000-4000-8000-000000000140'
                : `OL${3000 + index}W`,
            title: index === 140 ? 'Sparse album' : `Nonmatch ${index}`,
            state: HubRequestState.PENDING,
            points: 1,
            requestedBy,
            idempotencyKey: `sparse-${index}`,
            createdAt: new Date(base - index * 1_000),
            updatedAt: new Date(base - index * 1_000),
          })
      )
    );
    const agent = await loginAs('friend@seerr.dev');
    const first = await agent.get('/hub/activity?take=20&kinds=music_album');
    assert.deepStrictEqual(first.body.results, []);
    assert.strictEqual(first.body.scanExhausted, true);
    assert.strictEqual(first.body.nextScanCursor, 140);
    assert.strictEqual(first.body.nextSkip, 0);
    const next = await agent.get(
      `/hub/activity?take=20&kinds=music_album&scanCursor=${first.body.nextScanCursor}&skip=${first.body.nextSkip}`
    );
    assert.deepStrictEqual(
      next.body.results.map((item: { title: string }) => item.title),
      ['Sparse album']
    );
  });

  it('continues remaining matches in the same bounded scan window', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const base = Date.now();
    await getRepository(HubRequest).save(
      Array.from(
        { length: 30 },
        (_, index) =>
          new HubRequest({
            kind: HubMediaKind.MUSIC_ALBUM,
            provider: 'musicbrainz',
            externalId: `00000000-0000-4000-8000-${String(index).padStart(
              12,
              '0'
            )}`,
            title: `Album ${index}`,
            state: HubRequestState.PENDING,
            points: 1,
            requestedBy,
            idempotencyKey: `same-window-${index}`,
            createdAt: new Date(base - index * 1_000),
            updatedAt: new Date(base - index * 1_000),
          })
      )
    );
    const agent = await loginAs('friend@seerr.dev');
    const first = await agent.get('/hub/activity?take=20&kinds=music_album');
    assert.strictEqual(first.body.results.length, 20);
    assert.strictEqual(first.body.nextScanCursor, 0);
    assert.strictEqual(first.body.nextSkip, 20);
    const next = await agent.get(
      `/hub/activity?take=20&kinds=music_album&scanCursor=${first.body.nextScanCursor}&skip=${first.body.nextSkip}`
    );
    assert.deepStrictEqual(
      next.body.results.map((item: { title: string }) => item.title),
      Array.from({ length: 10 }, (_, index) => `Album ${index + 20}`)
    );
    assert.strictEqual(next.body.nextScanCursor, undefined);
    assert.strictEqual(next.body.nextSkip, undefined);
  });

  it('returns a cursor pair for ordinary unfiltered pagination', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    await getRepository(HubRequest).save(
      Array.from(
        { length: 45 },
        (_, index) =>
          new HubRequest({
            kind: HubMediaKind.BOOK,
            provider: 'openlibrary',
            externalId: `OL${5000 + index}W`,
            title: `Ordinary page ${index}`,
            state: HubRequestState.PENDING,
            points: 1,
            requestedBy,
            idempotencyKey: `ordinary-page-${index}`,
          })
      )
    );
    const agent = await loginAs('friend@seerr.dev');
    const first = await agent.get('/hub/activity?take=20');
    assert.strictEqual(first.body.hasMore, true);
    assert.strictEqual(first.body.nextScanCursor, 0);
    assert.strictEqual(first.body.nextSkip, 20);
    const second = await agent.get(
      `/hub/activity?take=20&scanCursor=${first.body.nextScanCursor}&skip=${first.body.nextSkip}`
    );
    assert.strictEqual(second.body.results.length, 20);
    assert.notDeepStrictEqual(
      second.body.results.map((item: { id: string }) => item.id),
      first.body.results.map((item: { id: string }) => item.id)
    );
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

describe('Hub OpenAPI contract', () => {
  it('declares every unified activity query parameter', () => {
    const specification = yaml.load(
      readFileSync(path.join(process.cwd(), 'seerr-api.yml'), 'utf8')
    ) as {
      paths: Record<
        string,
        {
          get?: {
            parameters: { in: string; name: string }[];
            responses: Record<string, Record<string, unknown>>;
          };
          post?: { responses: Record<string, Record<string, unknown>> };
        }
      >;
    };
    const activityOperation = specification.paths['/hub/activity'].get!;
    const queryParameters = activityOperation.parameters
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => parameter.name);

    assert.deepStrictEqual(queryParameters, [
      'take',
      'skip',
      'kinds',
      'formats',
      'states',
      'query',
      'scanCursor',
    ]);
    assert.deepStrictEqual(Object.keys(activityOperation.responses['200']), [
      'description',
      'content',
    ]);
    assert.strictEqual(
      typeof activityOperation.responses['200'].description,
      'string'
    );
    const responseSchema = activityOperation.responses['200'].content as {
      'application/json': {
        schema: {
          required: string[];
          properties: Record<string, Record<string, unknown>> & {
            acquisitionQueue: { required: string[] };
          };
        };
      };
    };
    assert.deepStrictEqual(responseSchema['application/json'].schema.required, [
      'results',
      'queue',
      'acquisitionQueue',
      'take',
      'skip',
      'total',
      'totalIsEstimate',
      'scanExhausted',
      'hasMore',
    ]);
    assert.ok(
      responseSchema[
        'application/json'
      ].schema.properties.acquisitionQueue.required.includes('recentIssues')
    );
    assert.ok(responseSchema['application/json'].schema.properties.nextSkip);
    for (const field of ['take', 'skip', 'total', 'hasMore']) {
      assert.ok(responseSchema['application/json'].schema.properties[field]);
    }
    assert.ok(specification.paths['/hub/acquisition/issues/{id}/retry']);
    assert.ok(specification.paths['/hub/acquisition/issues/{id}/acknowledge']);
    assert.deepStrictEqual(
      Object.keys(
        specification.paths['/hub/acquisition/issues/{id}/acknowledge'].post!
          .responses
      ),
      ['200', '403', '404']
    );
    assert.deepStrictEqual(
      Object.keys(
        specification.paths['/hub/acquisition/issues/{id}/retry'].post!
          .responses
      ),
      ['200', '403', '404', '409']
    );
  });
});
