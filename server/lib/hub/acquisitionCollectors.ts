import { HubMediaKind, HubRequestState } from '@server/constants/hub';
import { MediaType } from '@server/constants/media';
import type { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import type { HubRequest } from '@server/entity/HubRequest';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { integrationConfig } from '@server/lib/hub/integrations';
import axios from 'axios';
import {
  summarizeHubAcquisition,
  type HubAcquisition,
  type HubAcquisitionPhase,
} from './acquisitionStatus';

const phaseForState = (state: HubRequestState): HubAcquisitionPhase =>
  (
    ({
      [HubRequestState.PENDING]: 'searching',
      [HubRequestState.APPROVED]: 'searching',
      [HubRequestState.PROCESSING]: 'searching',
      [HubRequestState.SUBMITTED]: 'searching',
      [HubRequestState.DOWNLOADING]: 'downloading',
      [HubRequestState.IMPORTED]: 'import_pending',
      [HubRequestState.AVAILABLE]: 'available',
      [HubRequestState.FAILED]: 'failed',
      [HubRequestState.DECLINED]: 'unknown',
      [HubRequestState.CANCELLED]: 'unknown',
    }) as Record<HubRequestState, HubAcquisitionPhase>
  )[state];

const fallback = (
  request: HubRequest,
  issue?: HubAcquisitionIssue
): HubAcquisition => {
  const availability =
    request.state === HubRequestState.AVAILABLE
      ? ('available' as const)
      : request.state === HubRequestState.IMPORTED
        ? ('imported' as const)
        : ('missing' as const);
  const acquisition = summarizeHubAcquisition({
    availability,
    fallbackPhase: phaseForState(request.state),
    updatedAt: request.lastSyncedAt ?? request.updatedAt,
    issue,
  });
  return {
    ...acquisition,
    sources: request.targetService
      ? [request.targetService as 'lidarr' | 'lazylibrarian']
      : [],
  };
};

export const matchesLidarrQueueRecord = (
  kind: HubMediaKind,
  targetId: string,
  item: { artistId?: number; albumId?: number }
): boolean =>
  String(
    kind === HubMediaKind.MUSIC_ARTIST
      ? (item.artistId ?? '')
      : (item.albumId ?? '')
  ) === targetId;

export const lazyLibrarianAcquisitionPhase = (
  raw: string
): HubAcquisitionPhase =>
  /fail|error/.test(raw)
    ? 'failed'
    : /have|available|downloaded/.test(raw)
      ? 'available'
      : /download|snatch/.test(raw)
        ? 'downloading'
        : 'searching';

type LidarrQueueRecord = Record<string, unknown> & {
  artistId?: number;
  albumId?: number;
};

export interface PositionedLidarrQueueRecord {
  item: LidarrQueueRecord;
  queuePosition: number;
}

export interface LidarrQueueClient {
  get: (
    url: string,
    config?: { params?: Record<string, unknown> }
  ) => Promise<{
    data: { records?: LidarrQueueRecord[]; totalRecords?: number };
  }>;
}

export const loadLidarrQueuePages = async (
  client: LidarrQueueClient
): Promise<PositionedLidarrQueueRecord[]> => {
  const pageSize = 250;
  const maxPages = 20;
  const records: PositionedLidarrQueueRecord[] = [];
  let page = 1;
  let totalRecords = 0;
  do {
    const response = await client.get('/queue', {
      params: { page, pageSize },
    });
    const pageRecords = (response.data.records ?? []) as LidarrQueueRecord[];
    if (!pageRecords.length) break;
    records.push(
      ...pageRecords.map((item, index) => ({
        item,
        queuePosition: records.length + index + 1,
      }))
    );
    totalRecords = Number(response.data.totalRecords ?? records.length);
    page += 1;
  } while (records.length < totalRecords && page <= maxPages);
  return records;
};

const lidarrQueueCache = new Map<
  string,
  { expiresAt: number; promise: Promise<PositionedLidarrQueueRecord[]> }
>();

export const getSharedLidarrQueue = (
  cacheKey: string,
  client: LidarrQueueClient
): Promise<PositionedLidarrQueueRecord[]> => {
  const cached = lidarrQueueCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadLidarrQueuePages(client).catch((error) => {
    lidarrQueueCache.delete(cacheKey);
    throw error;
  });
  lidarrQueueCache.set(cacheKey, {
    expiresAt: Date.now() + 30_000,
    promise,
  });
  return promise;
};

const collectHubRequestAcquisitionUncached = async (
  request: HubRequest,
  issue?: HubAcquisitionIssue
): Promise<HubAcquisition> => {
  if (
    ![HubRequestState.SUBMITTED, HubRequestState.DOWNLOADING].includes(
      request.state
    ) ||
    !request.targetId
  ) {
    return fallback(request, issue);
  }
  if (request.targetService === 'lidarr') {
    const { url, apiKey } = integrationConfig('lidarr');
    if (!url || !apiKey) return fallback(request, issue);
    try {
      const client = axios.create({
        baseURL: `${url}/api/v1`,
        timeout: 6_000,
        maxRedirects: 0,
        headers: { 'X-Api-Key': apiKey },
      });
      const resource =
        request.kind === HubMediaKind.MUSIC_ARTIST ? 'artist' : 'album';
      const [detail, queue] = await Promise.all([
        client.get(`/${resource}/${encodeURIComponent(request.targetId)}`),
        getSharedLidarrQueue(`${url}\0${apiKey}`, client),
      ]);
      const statistics = detail.data.statistics ?? {};
      const imported = Number(
        statistics.trackFileCount ?? statistics.albumFileCount ?? 0
      );
      const requested = Number(statistics.totalTrackCount ?? 0);
      const records = queue.filter(({ item }) =>
        matchesLidarrQueueRecord(request.kind, request.targetId!, item)
      );
      const downloads: DownloadingItem[] = records.map(
        ({ item, queuePosition }) => ({
          mediaType: MediaType.MOVIE,
          externalId: Number(request.targetId),
          size: Number(item.size ?? 0),
          sizeLeft: Number(item.sizeleft ?? 0),
          status: String(item.status ?? ''),
          timeLeft: String(item.timeleft ?? ''),
          estimatedCompletionTime: new Date(
            String(item.estimatedCompletionTime ?? '')
          ),
          title: '',
          downloadId: String(item.downloadId ?? `lidarr-${queuePosition}`),
          trackedDownloadStatus: String(item.trackedDownloadStatus ?? ''),
          trackedDownloadState: String(item.trackedDownloadState ?? ''),
          queuePosition,
          source: 'lidarr',
        })
      );
      return summarizeHubAcquisition({
        downloads,
        availability:
          requested > 0 && imported >= requested
            ? 'available'
            : imported > 0
              ? 'partial'
              : 'missing',
        fallbackPhase: records.length ? 'queued' : 'searching',
        counts: { requested, queued: records.length, imported },
        updatedAt: new Date(),
        issue,
      });
    } catch {
      const acquisition = fallback(request, issue);
      return { ...acquisition, health: 'stale', stale: true };
    }
  }
  if (request.targetService === 'lazylibrarian') {
    const { url, apiKey } = integrationConfig('lazylibrarian');
    if (!url || !apiKey) return fallback(request, issue);
    try {
      const response = await axios.get(`${url}/api`, {
        timeout: 6_000,
        maxRedirects: 0,
        params: { apikey: apiKey, cmd: 'getBook', id: request.targetId },
      });
      const record = Array.isArray(response.data)
        ? response.data[0]
        : (response.data?.books?.[0] ??
          response.data?.result?.[0] ??
          response.data);
      const raw = Object.entries((record ?? {}) as Record<string, unknown>)
        .filter(([key]) => /status|state/i.test(key))
        .map(([, value]) => String(value).toLowerCase())
        .join(' ');
      const phase = lazyLibrarianAcquisitionPhase(raw);
      const acquisition = summarizeHubAcquisition({
        availability: phase === 'available' ? 'available' : 'missing',
        fallbackPhase: phase,
        updatedAt: new Date(),
        issue,
      });
      return { ...acquisition, sources: ['lazylibrarian'] };
    } catch {
      const acquisition = fallback(request, issue);
      return { ...acquisition, health: 'stale', stale: true };
    }
  }
  return fallback(request, issue);
};

const acquisitionCache = new Map<
  string,
  { expiresAt: number; value: HubAcquisition }
>();

export const collectHubRequestAcquisition = async (
  request: HubRequest,
  issue?: HubAcquisitionIssue
): Promise<HubAcquisition> => {
  if (issue || !request.targetService || !request.targetId)
    return collectHubRequestAcquisitionUncached(request, issue);
  const key = `${request.targetService}:${request.targetId}:${request.kind}:${request.state}`;
  const cached = acquisitionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await collectHubRequestAcquisitionUncached(request);
  acquisitionCache.set(key, { expiresAt: Date.now() + 30_000, value });
  return value;
};

export const clearHubAcquisitionCollectorCache = (): void => {
  acquisitionCache.clear();
  lidarrQueueCache.clear();
};
