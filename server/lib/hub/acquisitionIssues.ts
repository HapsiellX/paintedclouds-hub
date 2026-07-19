import { HubRequestState } from '@server/constants/hub';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import { HubRequest } from '@server/entity/HubRequest';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { In, IsNull, LessThan, MoreThanOrEqual, Not } from 'typeorm';

export const ACQUISITION_ISSUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
let lastCleanupAt = 0;
let cleanupPromise: Promise<number> | undefined;

export const cleanupAcquisitionIssues = async (
  now = new Date()
): Promise<number> => {
  const result = await getRepository(HubAcquisitionIssue).delete({
    resolvedAt: LessThan(
      new Date(now.getTime() - ACQUISITION_ISSUE_RETENTION_MS)
    ),
  });
  let removed = result.affected ?? 0;
  const open = await getRepository(HubAcquisitionIssue).find({
    where: { resolvedAt: IsNull() },
  });
  const hubIds = [
    ...new Set(
      open
        .filter((issue) => issue.requestSource === 'hub')
        .map((issue) => issue.requestId)
    ),
  ];
  const videoIds = [
    ...new Set(
      open
        .filter((issue) => issue.requestSource === 'seerr')
        .map((issue) => issue.requestId)
    ),
  ];
  const [hubRequests, videoRequests] = await Promise.all([
    hubIds.length ? getRepository(HubRequest).findBy({ id: In(hubIds) }) : [],
    videoIds.length
      ? getRepository(MediaRequest).findBy({ id: In(videoIds) })
      : [],
  ]);
  const hubs = new Map(hubRequests.map((request) => [request.id, request]));
  const videos = new Map(videoRequests.map((request) => [request.id, request]));
  const orphanIds = open
    .filter((issue) =>
      issue.requestSource === 'hub'
        ? !hubs.has(issue.requestId)
        : !videos.has(issue.requestId)
    )
    .map((issue) => issue.id);
  const inactiveIds = open
    .filter((issue) => {
      const request =
        issue.requestSource === 'hub'
          ? hubs.get(issue.requestId)
          : videos.get(issue.requestId);
      return request
        ? issue.requestSource === 'hub'
          ? [HubRequestState.CANCELLED, HubRequestState.DECLINED].includes(
              (request as HubRequest).state
            )
          : (request as MediaRequest).status === MediaRequestStatus.DECLINED
        : false;
    })
    .map((issue) => issue.id);
  if (orphanIds.length) {
    const orphanResult = await getRepository(HubAcquisitionIssue).delete({
      id: In(orphanIds),
    });
    removed += orphanResult.affected ?? 0;
  }
  if (inactiveIds.length) {
    await getRepository(HubAcquisitionIssue).update(
      { id: In(inactiveIds) },
      { resolvedAt: now }
    );
  }
  return removed;
};

const maybeCleanupAcquisitionIssues = async (): Promise<void> => {
  if (Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  if (!cleanupPromise) {
    cleanupPromise = cleanupAcquisitionIssues().finally(() => {
      lastCleanupAt = Date.now();
      cleanupPromise = undefined;
    });
  }
  await cleanupPromise;
};

export const SAFE_ACQUISITION_MESSAGES: Record<string, string> = {
  download_failed: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
  provider_warning: 'Der Mediendienst meldet ein Problem mit diesem Download.',
  submission_failed: 'Die Übermittlung an den Mediendienst ist fehlgeschlagen.',
  provider_failed: 'Der Mediendienst meldet einen fehlgeschlagenen Download.',
};

export const visibleAcquisitionIssueWhere = (user: User) =>
  user.hasPermission(
    [Permission.ADMIN, Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  )
    ? {}
    : { requestedBy: { id: user.id } };

export const findAcquisitionIssues = async (
  user: User
): Promise<HubAcquisitionIssue[]> => {
  await maybeCleanupAcquisitionIssues();
  return getRepository(HubAcquisitionIssue).find({
    where: { ...visibleAcquisitionIssueWhere(user), resolvedAt: IsNull() },
    order: { updatedAt: 'DESC' },
  });
};

export const findRecentResolvedAcquisitionIssues = async (
  user: User,
  now = new Date()
): Promise<HubAcquisitionIssue[]> => {
  return getRepository(HubAcquisitionIssue).find({
    where: {
      ...visibleAcquisitionIssueWhere(user),
      resolvedAt: MoreThanOrEqual(
        new Date(now.getTime() - ACQUISITION_ISSUE_RETENTION_MS)
      ),
    },
    order: { resolvedAt: 'DESC' },
  });
};

export const recordAcquisitionIssue = async ({
  requestSource,
  requestId,
  kind,
  externalId,
  is4k = false,
  reasonCode,
  partKey = '',
  requestedBy,
  reopenResolved = true,
  retryable = reasonCode !== 'provider_failed',
}: Omit<
  Pick<
    HubAcquisitionIssue,
    | 'requestSource'
    | 'requestId'
    | 'kind'
    | 'externalId'
    | 'is4k'
    | 'reasonCode'
    | 'partKey'
    | 'requestedBy'
  >,
  'partKey'
> & {
  partKey?: string;
  reopenResolved?: boolean;
  retryable?: boolean;
}): Promise<HubAcquisitionIssue> => {
  const repository = getRepository(HubAcquisitionIssue);
  const now = new Date();
  await repository.update(
    {
      requestSource,
      requestId,
      is4k,
      partKey,
      reasonCode: Not(reasonCode),
      resolvedAt: IsNull(),
    },
    { resolvedAt: now }
  );
  let issue = await repository.findOneBy({
    requestSource,
    requestId,
    is4k,
    partKey,
    reasonCode,
  });
  if (!issue) {
    const values = repository.create({
      requestSource,
      requestId,
      kind,
      externalId,
      is4k,
      reasonCode,
      partKey,
      message:
        SAFE_ACQUISITION_MESSAGES[reasonCode] ??
        SAFE_ACQUISITION_MESSAGES.download_failed,
      retryable,
      requestedBy,
      lastSeenAt: now,
    });
    await repository
      .createQueryBuilder()
      .insert()
      .values(values)
      .orIgnore()
      .execute();
    issue = await repository.findOneByOrFail({
      requestSource,
      requestId,
      is4k,
      partKey,
      reasonCode,
    });
  }
  if (issue) {
    issue.lastSeenAt = now;
    issue.retryable = retryable;
    if (reopenResolved && issue.resolvedAt) {
      issue.resolvedAt = null;
      issue.acknowledgedAt = null;
    }
  }
  return repository.save(issue);
};

export const resolveAcquisitionIssues = async (
  requestSource: 'seerr' | 'hub',
  requestId: number
): Promise<void> => {
  await getRepository(HubAcquisitionIssue).update(
    { requestSource, requestId, resolvedAt: IsNull() },
    { resolvedAt: new Date() }
  );
};

export const resolveAcquisitionIssuePart = async (
  requestSource: 'seerr' | 'hub',
  requestId: number,
  partKey: string
): Promise<void> => {
  await getRepository(HubAcquisitionIssue).update(
    { requestSource, requestId, partKey, resolvedAt: IsNull() },
    { resolvedAt: new Date() }
  );
};
