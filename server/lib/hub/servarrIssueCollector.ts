import type { HistoryItem } from '@server/api/servarr/base';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { In, IsNull } from 'typeorm';
import {
  recordAcquisitionIssue,
  resolveAcquisitionIssuePart,
} from './acquisitionIssues';
import {
  canonicalEpisodePartKey,
  episodeForPartKey,
  normalizeAcquisitionPhase,
} from './acquisitionStatus';

const partKeyFor = (item: DownloadingItem): string =>
  item.episode
    ? canonicalEpisodePartKey(
        item.episode.seasonNumber,
        item.episode.episodeNumber
      )
    : '';

export const persistServarrQueueIssues = async (
  source: 'radarr' | 'sonarr',
  serverId: number,
  items: DownloadingItem[],
  loadedRequests?: MediaRequest[]
): Promise<void> => {
  const requests = loadedRequests ?? (await findActiveServarrIssueRequests());
  for (const request of requests) {
    if (
      request.status === MediaRequestStatus.DECLINED ||
      request.status === MediaRequestStatus.COMPLETED
    ) {
      continue;
    }
    const serviceId = request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
    const externalId =
      request.media[request.is4k ? 'externalServiceId4k' : 'externalServiceId'];
    if (serviceId !== serverId || externalId == null) continue;
    const matching = items.filter(
      (item) =>
        item.externalId === externalId &&
        item.mediaType ===
          (source === 'radarr' ? MediaType.MOVIE : MediaType.TV) &&
        (source === 'radarr' ||
          (item.episode != null &&
            request.seasons.some(
              (season) => season.seasonNumber === item.episode?.seasonNumber
            )))
    );
    const failures = matching.filter(
      (item) => normalizeAcquisitionPhase(item).phase === 'failed'
    );
    if (source === 'sonarr') {
      for (const active of matching.filter(
        (item) => normalizeAcquisitionPhase(item).phase !== 'failed'
      )) {
        const partKey = partKeyFor(active);
        if (partKey) {
          await resolveAcquisitionIssuePart('seerr', request.id, partKey);
        }
      }
    }
    if (failures.length) {
      for (const failure of failures) {
        const normalized = normalizeAcquisitionPhase(failure);
        await recordAcquisitionIssue({
          requestSource: 'seerr',
          requestId: request.id,
          kind: request.type,
          externalId: String(request.media.tmdbId),
          is4k: request.is4k,
          partKey: partKeyFor(failure),
          reasonCode: normalized.reasonCode ?? 'download_failed',
          requestedBy: request.requestedBy,
        });
      }
    }
  }
};

export const persistServarrHistoryIssues = async (
  source: 'radarr' | 'sonarr',
  serverId: number,
  history: HistoryItem[],
  loadedRequests?: MediaRequest[],
  episodeStates?: Map<number, ServarrEpisodeState[]>,
  currentQueue: DownloadingItem[] = []
): Promise<void> => {
  const events = history.filter(
    (item) =>
      /fail|import/i.test(item.eventType) &&
      Date.now() - new Date(item.date).getTime() < 7 * 24 * 60 * 60 * 1_000
  );
  if (!events.length) return;
  const requests = loadedRequests ?? (await findActiveServarrIssueRequests());
  for (const request of requests) {
    const serviceId = request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
    const externalId =
      request.media[request.is4k ? 'externalServiceId4k' : 'externalServiceId'];
    if (serviceId !== serverId || externalId == null) continue;
    const relevant = events.filter(
      (event) =>
        (source === 'radarr' ? event.movieId : event.seriesId) === externalId
    );
    const latestByPart = new Map<string, HistoryItem>();
    for (const event of relevant) {
      const season = event.episode?.seasonNumber ?? event.data?.seasonNumber;
      const episode = event.episode?.episodeNumber ?? event.data?.episodeNumber;
      const seasonNumber = Number(season);
      const episodeNumber = Number(episode);
      if (
        source === 'sonarr' &&
        (!Number.isInteger(seasonNumber) ||
          seasonNumber < 0 ||
          !Number.isInteger(episodeNumber) ||
          episodeNumber <= 0 ||
          !request.seasons.some(
            (candidate) => candidate.seasonNumber === seasonNumber
          ))
      ) {
        continue;
      }
      const partKey =
        source === 'radarr'
          ? ''
          : canonicalEpisodePartKey(seasonNumber, episodeNumber);
      const current = latestByPart.get(partKey);
      if (!current || new Date(event.date) > new Date(current.date)) {
        latestByPart.set(partKey, event);
      }
    }
    for (const [partKey, latest] of latestByPart) {
      if (/fail/i.test(latest.eventType)) {
        if (
          request.status === MediaRequestStatus.DECLINED ||
          request.status === MediaRequestStatus.COMPLETED
        ) {
          continue;
        }
        if (source === 'sonarr') {
          const episode = episodeForPartKey(partKey);
          const state = episodeStates
            ?.get(externalId)
            ?.find(
              (candidate) =>
                candidate.seasonNumber === episode?.seasonNumber &&
                candidate.episodeNumber === episode?.episodeNumber
            );
          const airDate = state?.airDateUtc ?? state?.airDate;
          const notAired = Boolean(
            airDate && new Date(airDate).getTime() > Date.now()
          );
          const activelyProcessing = currentQueue.some(
            (item) =>
              item.mediaType === MediaType.TV &&
              item.externalId === externalId &&
              partKeyFor(item) === partKey &&
              normalizeAcquisitionPhase(item).phase !== 'failed'
          );
          if (state?.hasFile || notAired || activelyProcessing) {
            await resolveAcquisitionIssuePart('seerr', request.id, partKey);
            continue;
          }
        }
        await recordAcquisitionIssue({
          requestSource: 'seerr',
          requestId: request.id,
          kind: request.type,
          externalId: String(request.media.tmdbId),
          is4k: request.is4k,
          partKey,
          reasonCode: 'download_failed',
          requestedBy: request.requestedBy,
          reopenResolved: true,
        });
      } else {
        await resolveAcquisitionIssuePart('seerr', request.id, partKey);
      }
    }
  }
};

export interface ServarrEpisodeState {
  seasonNumber: number;
  episodeNumber: number;
  hasFile: boolean;
  airDate?: string;
  airDateUtc?: string;
}

export const findActiveServarrIssueRequests = async (): Promise<
  MediaRequest[]
> => {
  const openIssues = await getRepository(HubAcquisitionIssue).find({
    where: { requestSource: 'seerr', resolvedAt: IsNull() },
    select: { requestId: true },
  });
  const completedWithOpenIssue = [
    ...new Set(openIssues.map((issue) => issue.requestId)),
  ];
  return getRepository(MediaRequest).find({
    where: [
      {
        status: In([
          MediaRequestStatus.PENDING,
          MediaRequestStatus.APPROVED,
          MediaRequestStatus.FAILED,
        ]),
      },
      ...(completedWithOpenIssue.length
        ? [
            {
              id: In(completedWithOpenIssue),
              status: MediaRequestStatus.COMPLETED,
            },
          ]
        : []),
    ],
  });
};
