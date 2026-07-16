import { HubMediaKind, HubRequestFormat } from '@server/constants/hub';
import { getRepository, isPgsql } from '@server/datasource';
import {
  HubQuotaLedger,
  HubQuotaLedgerState,
} from '@server/entity/HubQuotaLedger';
import type { HubRequest } from '@server/entity/HubRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import AsyncLock from '@server/utils/asyncLock';
import type { EntityManager } from 'typeorm';

const quotaLock = new AsyncLock();

export interface HubQuotaStatus {
  enabled: boolean;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  windowDays: number;
}

export const configuredHubRequestPoints = (
  kind: HubMediaKind,
  formats: HubRequestFormat[] = []
): number => {
  const weights = getSettings().hub.quota.weights;
  if (kind !== HubMediaKind.BOOK) return weights[kind] ?? 1;
  const ebook = formats.includes(HubRequestFormat.EBOOK);
  const audiobook = formats.includes(HubRequestFormat.AUDIOBOOK);
  if (ebook && audiobook) return weights.book_both ?? 3;
  return audiobook ? (weights.audiobook ?? 2) : (weights.ebook ?? 1);
};

const quotaWindowStart = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const statusWithManager = async (
  manager: EntityManager,
  user: User
): Promise<HubQuotaStatus> => {
  const config = getSettings().hub.quota;
  const limit = user.hubQuotaLimit ?? config.defaultPoints;
  const windowDays = user.hubQuotaDays ?? config.windowDays;
  if (!config.enabled || user.hasPermission(Permission.ADMIN)) {
    return {
      enabled: false,
      limit,
      used: 0,
      reserved: 0,
      remaining: limit,
      windowDays,
    };
  }
  const rows = await manager
    .createQueryBuilder(HubQuotaLedger, 'ledger')
    .select('ledger.state', 'state')
    .addSelect('COALESCE(SUM(ledger.points), 0)', 'points')
    .where('ledger.userId = :userId', { userId: user.id })
    .andWhere('ledger.createdAt >= :start', {
      start: quotaWindowStart(windowDays),
    })
    .andWhere('ledger.state IN (:...states)', {
      states: [HubQuotaLedgerState.RESERVED, HubQuotaLedgerState.CONSUMED],
    })
    .groupBy('ledger.state')
    .getRawMany<{ state: HubQuotaLedgerState; points: string }>();
  const reserved = Number(
    rows.find((row) => row.state === HubQuotaLedgerState.RESERVED)?.points ?? 0
  );
  const used = Number(
    rows.find((row) => row.state === HubQuotaLedgerState.CONSUMED)?.points ?? 0
  );
  return {
    enabled: true,
    limit,
    used,
    reserved,
    remaining: Math.max(0, limit - used - reserved),
    windowDays,
  };
};

export const getHubQuotaStatus = (user: User): Promise<HubQuotaStatus> =>
  statusWithManager(getRepository(HubQuotaLedger).manager, user);

export const reserveHubQuota = async (
  request: HubRequest,
  user: User
): Promise<{ allowed: boolean; status: HubQuotaStatus }> => {
  if (user.hasPermission(Permission.ADMIN)) {
    return { allowed: true, status: await getHubQuotaStatus(user) };
  }
  return quotaLock.dispatch(`hub-quota:${user.id}`, () =>
    getRepository(HubQuotaLedger).manager.transaction(async (manager) => {
      const lockedUser = await manager.findOneOrFail(User, {
        where: { id: user.id },
        ...(isPgsql ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      const status = await statusWithManager(manager, lockedUser);
      if (!status.enabled || request.points > status.remaining) {
        return { allowed: false, status };
      }
      await manager.save(HubQuotaLedger, {
        request,
        user: lockedUser,
        points: request.points,
        state: HubQuotaLedgerState.RESERVED,
      });
      return {
        allowed: true,
        status: {
          ...status,
          reserved: status.reserved + request.points,
          remaining: status.remaining - request.points,
        },
      };
    })
  );
};

const transitionLedger = async (
  requestId: number,
  state: HubQuotaLedgerState
): Promise<void> => {
  const repository = getRepository(HubQuotaLedger);
  const ledger = await repository.findOne({
    where: { request: { id: requestId } },
  });
  if (!ledger || ledger.state !== HubQuotaLedgerState.RESERVED) return;
  ledger.state = state;
  if (state === HubQuotaLedgerState.CONSUMED) ledger.consumedAt = new Date();
  if (state === HubQuotaLedgerState.RELEASED) ledger.releasedAt = new Date();
  await repository.save(ledger);
};

export const consumeHubQuota = (requestId: number) =>
  transitionLedger(requestId, HubQuotaLedgerState.CONSUMED);
export const releaseHubQuota = (requestId: number) =>
  transitionLedger(requestId, HubQuotaLedgerState.RELEASED);
