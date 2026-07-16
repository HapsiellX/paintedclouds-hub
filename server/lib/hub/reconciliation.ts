import { HubMediaKind, HubRequestState } from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { integrationConfig } from '@server/lib/hub/integrations';
import logger from '@server/logger';
import axios from 'axios';
import { In } from 'typeorm';

export interface HubReconciliationStatus {
  running: boolean;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  checked: number;
  changed: number;
  failed: number;
}

const status: HubReconciliationStatus = {
  running: false,
  checked: 0,
  changed: 0,
  failed: 0,
};

export const getHubReconciliationStatus = (): HubReconciliationStatus => ({
  ...status,
});

export const lidarrStatisticsState = (
  statistics: Record<string, unknown>
): HubRequestState | undefined => {
  const files = Number(
    statistics.trackFileCount ?? statistics.albumFileCount ?? 0
  );
  const total = Number(statistics.totalTrackCount ?? 0);
  const size = Number(statistics.sizeOnDisk ?? 0);
  const percent = Number(statistics.percentOfEpisodes ?? 0);
  if ((total > 0 && files >= total) || percent >= 100) {
    return HubRequestState.AVAILABLE;
  }
  if (files > 0 || size > 0) return HubRequestState.IMPORTED;
  return undefined;
};

export const lazyLibrarianRecordState = (
  record: Record<string, unknown>
): HubRequestState => {
  const states = Object.entries(record)
    .filter(([key]) => /status|state/i.test(key))
    .map(([, value]) => String(value).toLowerCase());
  if (
    states.some((value) => /^(open|have|available|downloaded)$/.test(value))
  ) {
    return HubRequestState.AVAILABLE;
  }
  if (states.some((value) => /^(snatched|downloading|wanted)$/.test(value))) {
    return HubRequestState.DOWNLOADING;
  }
  return HubRequestState.SUBMITTED;
};

const lidarrState = async (request: HubRequest): Promise<HubRequestState> => {
  const config = integrationConfig('lidarr');
  if (!config.url || !config.apiKey || !request.targetId) return request.state;
  const resource =
    request.kind === HubMediaKind.MUSIC_ARTIST ? 'artist' : 'album';
  const response = await axios.get(
    `${config.url}/api/v1/${resource}/${encodeURIComponent(request.targetId)}`,
    { timeout: 10_000, headers: { 'X-Api-Key': config.apiKey } }
  );
  const statistics = response.data.statistics ?? {};
  const importedState = lidarrStatisticsState(statistics);
  if (importedState) return importedState;
  const queue = await axios.get(`${config.url}/api/v1/queue`, {
    timeout: 10_000,
    headers: { 'X-Api-Key': config.apiKey },
    params: { page: 1, pageSize: 100 },
  });
  const queued = (queue.data.records ?? []).some(
    (item: { artistId?: number; albumId?: number }) =>
      String(item.artistId ?? item.albumId ?? '') === request.targetId
  );
  return queued ? HubRequestState.DOWNLOADING : HubRequestState.SUBMITTED;
};

const lazyLibrarianState = async (
  request: HubRequest
): Promise<HubRequestState> => {
  const config = integrationConfig('lazylibrarian');
  if (!config.url || !config.apiKey || !request.targetId) return request.state;
  const response = await axios.get(`${config.url}/api`, {
    timeout: 10_000,
    params: { apikey: config.apiKey, cmd: 'getBook', id: request.targetId },
  });
  const book = Array.isArray(response.data)
    ? response.data[0]
    : (response.data?.books?.[0] ??
      response.data?.result?.[0] ??
      response.data);
  const record = (book ?? {}) as Record<string, unknown>;
  return lazyLibrarianRecordState(record);
};

export const reconcileHubRequests = async (
  requestId?: number
): Promise<HubReconciliationStatus> => {
  if (status.running) return getHubReconciliationStatus();
  status.running = true;
  status.lastStartedAt = new Date().toISOString();
  status.checked = 0;
  status.changed = 0;
  status.failed = 0;
  const repository = getRepository(HubRequest);
  try {
    const requests = await repository.find({
      where: requestId
        ? { id: requestId }
        : {
            state: In([
              HubRequestState.SUBMITTED,
              HubRequestState.DOWNLOADING,
              HubRequestState.IMPORTED,
            ]),
          },
      take: requestId ? 1 : 500,
    });
    for (const request of requests) {
      status.checked += 1;
      try {
        const nextState =
          request.targetService === 'lidarr'
            ? await lidarrState(request)
            : await lazyLibrarianState(request);
        if (nextState !== request.state) {
          const previousState = request.state;
          request.state = nextState;
          status.changed += 1;
          await getRepository(HubAuditEvent).save({
            request,
            action: 'state_changed',
            details: { from: previousState, to: nextState },
          });
        }
        request.lastSyncedAt = new Date();
        request.errorMessage = null;
        await repository.save(request);
      } catch (error) {
        status.failed += 1;
        logger.warn('Hub request reconciliation failed', {
          label: 'PaintedClouds Hub',
          requestId: request.id,
          errorMessage: (error as Error).message,
        });
      }
    }
  } finally {
    status.running = false;
    status.lastCompletedAt = new Date().toISOString();
  }
  return getHubReconciliationStatus();
};
