import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { HubMediaKind, HubRequestState } from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubQuotaLedger } from '@server/entity/HubQuotaLedger';
import { HubRequest } from '@server/entity/HubRequest';
import { User } from '@server/entity/User';
import {
  configuredHubRequestPoints,
  consumeHubQuota,
  getHubQuotaStatus,
  releaseHubQuota,
  reserveHubQuota,
} from '@server/lib/hub/quota';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

setupTestDb();

beforeEach(async () => {
  await getRepository(HubQuotaLedger).createQueryBuilder().delete().execute();
  await getRepository(HubRequest).createQueryBuilder().delete().execute();
  const settings = getSettings();
  settings.hub.quota.enabled = true;
  settings.hub.quota.defaultPoints = 3;
  settings.hub.quota.windowDays = 30;
});

const createRequest = async (user: User, id: string, points: number) =>
  getRepository(HubRequest).save(
    new HubRequest({
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary',
      externalId: id,
      title: id,
      state: HubRequestState.PENDING,
      points,
      requestedBy: user,
      idempotencyKey: `quota-${id}`,
    })
  );

describe('PaintedClouds Hub transactional quota', () => {
  it('allows only one of two concurrent reservations beyond the limit', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    user.hubQuotaLimit = undefined;
    user.hubQuotaDays = undefined;
    await getRepository(User).save(user);
    const [first, second] = await Promise.all([
      createRequest(user, 'OL910W', 2),
      createRequest(user, 'OL920W', 2),
    ]);

    const reservations = await Promise.all([
      reserveHubQuota(first, user),
      reserveHubQuota(second, user),
    ]);
    assert.equal(reservations.filter((result) => result.allowed).length, 1);
    const quota = await getHubQuotaStatus(user);
    assert.equal(quota.reserved, 2);
    assert.equal(quota.remaining, 1);
  });

  it('consumes accepted work and releases a final failure', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const accepted = await createRequest(user, 'OL930W', 2);
    assert.equal((await reserveHubQuota(accepted, user)).allowed, true);
    await consumeHubQuota(accepted.id);
    assert.deepEqual(
      (({ used, reserved, remaining }) => ({ used, reserved, remaining }))(
        await getHubQuotaStatus(user)
      ),
      { used: 2, reserved: 0, remaining: 1 }
    );

    const failed = await createRequest(user, 'OL940W', 1);
    assert.equal((await reserveHubQuota(failed, user)).allowed, true);
    await releaseHubQuota(failed.id);
    assert.equal((await getHubQuotaStatus(user)).remaining, 1);
  });

  it('uses administrator-configured media weights', () => {
    getSettings().hub.quota.weights.music_artist = 7;
    assert.equal(configuredHubRequestPoints(HubMediaKind.MUSIC_ARTIST), 7);
  });
});
