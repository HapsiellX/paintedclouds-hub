import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI, { type EpisodeResult } from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import { uniqWith } from 'lodash';
import { integrationConfig } from './hub/integrations';
import {
  findActiveServarrIssueRequests,
  persistServarrHistoryIssues,
  persistServarrQueueIssues,
} from './hub/servarrIssueCollector';
import { processTorrentFallbacks } from './hub/torrentFallback';

interface EpisodeNumberResult {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  id: number;
}
export interface DownloadingItem {
  mediaType: MediaType;
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  estimatedCompletionTime: Date;
  title: string;
  downloadId: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  protocol?: string;
  downloadClient?: string;
  clientStatus?: string;
  clientActive?: boolean;
  queuePosition?: number;
  statusMessages?: { title?: string; messages?: string[] }[];
  source?: 'radarr' | 'sonarr' | 'lidarr';
  episode?: EpisodeNumberResult;
}

export interface DownloadTrackerStatus {
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  stale: boolean;
  updating: boolean;
  providers: Record<'radarr' | 'sonarr' | 'sabnzbd', boolean>;
  providerLastSuccessfulSyncAt: Partial<
    Record<'radarr' | 'sonarr' | 'sabnzbd', string>
  >;
  providerStale: Record<'radarr' | 'sonarr' | 'sabnzbd', boolean>;
  serverLastSuccessfulSyncAt?: {
    radarr: Record<number, string>;
    sonarr: Record<number, string>;
  };
  serverStale?: {
    radarr: Record<number, boolean>;
    sonarr: Record<number, boolean>;
  };
}

export interface HubVideoAcquisitionSnapshot {
  availability: 'missing' | 'partial' | 'imported' | 'available';
  waitingForRelease: boolean;
  requested?: number;
  imported?: number;
  queued?: number;
  failed?: number;
  seasons?: Record<
    number,
    { requested: number; imported: number; queued: number; failed: number }
  >;
}

const STALE_AFTER_MS = 150_000;

interface SabQueueSlot {
  status: string;
  position: number;
  sizeLeft?: number;
}

const mapWithLimit = async <T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await mapper(values[index]);
      }
    })
  );
  return results;
};

const getSabQueue = async (): Promise<Map<string, SabQueueSlot>> => {
  const { url, apiKey } = integrationConfig('sabnzbd');
  if (!url || !apiKey) return new Map();
  const response = await axios.get(`${url}/api`, {
    timeout: 6_000,
    maxRedirects: 0,
    params: { mode: 'queue', output: 'json', apikey: apiKey },
  });
  return new Map<string, SabQueueSlot>(
    (response.data.queue?.slots ?? []).map(
      (
        slot: { nzo_id?: string; status?: string; mbleft?: string },
        index: number
      ) => [
        String(slot.nzo_id ?? ''),
        {
          status: String(slot.status ?? ''),
          position: index + 1,
          sizeLeft: Number.isFinite(Number(slot.mbleft))
            ? Number(slot.mbleft) * 1_000_000
            : undefined,
        },
      ]
    )
  );
};

class DownloadTracker {
  private radarrServers: Record<number, DownloadingItem[]> = {};
  private sonarrServers: Record<number, DownloadingItem[]> = {};
  private radarrCatalog: Record<
    number,
    Record<number, HubVideoAcquisitionSnapshot>
  > = {};
  private sonarrCatalog: Record<
    number,
    Record<number, HubVideoAcquisitionSnapshot>
  > = {};
  private lastAttemptAt?: Date;
  private lastSuccessfulSyncAt?: Date;
  private updating = false;
  private providerHealth = { radarr: true, sonarr: true, sabnzbd: true };
  private providerLastSuccessfulSyncAt: Partial<
    Record<'radarr' | 'sonarr' | 'sabnzbd', Date>
  > = {};
  private serverHealth = {
    radarr: {} as Record<number, boolean>,
    sonarr: {} as Record<number, boolean>,
  };
  private serverLastSuccessfulSyncAt = {
    radarr: {} as Record<number, Date>,
    sonarr: {} as Record<number, Date>,
  };
  private sabSizeLeft = new Map<string, number>();

  public getStatus(): DownloadTrackerStatus {
    const providerStale = Object.fromEntries(
      (['radarr', 'sonarr', 'sabnzbd'] as const).map((provider) => {
        const lastSuccess = this.providerLastSuccessfulSyncAt[provider];
        return [
          provider,
          !this.providerHealth[provider] ||
            !lastSuccess ||
            Date.now() - lastSuccess.getTime() > STALE_AFTER_MS,
        ];
      })
    ) as Record<'radarr' | 'sonarr' | 'sabnzbd', boolean>;
    const serverStale = Object.fromEntries(
      (['radarr', 'sonarr'] as const).map((provider) => [
        provider,
        Object.fromEntries(
          Object.entries(this.serverHealth[provider]).map(
            ([serverId, healthy]) => {
              const lastSuccess =
                this.serverLastSuccessfulSyncAt[provider][Number(serverId)];
              return [
                serverId,
                !healthy ||
                  !lastSuccess ||
                  Date.now() - lastSuccess.getTime() > STALE_AFTER_MS,
              ];
            }
          )
        ),
      ])
    ) as DownloadTrackerStatus['serverStale'];
    return {
      lastAttemptAt: this.lastAttemptAt?.toISOString(),
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt?.toISOString(),
      stale:
        !this.lastSuccessfulSyncAt ||
        Date.now() - this.lastSuccessfulSyncAt.getTime() > STALE_AFTER_MS ||
        Object.values(this.providerHealth).some((healthy) => !healthy),
      updating: this.updating,
      providers: { ...this.providerHealth },
      providerLastSuccessfulSyncAt: Object.fromEntries(
        Object.entries(this.providerLastSuccessfulSyncAt).map(
          ([provider, date]) => [provider, date?.toISOString()]
        )
      ),
      providerStale,
      serverLastSuccessfulSyncAt: {
        radarr: Object.fromEntries(
          Object.entries(this.serverLastSuccessfulSyncAt.radarr).map(
            ([serverId, date]) => [serverId, date.toISOString()]
          )
        ),
        sonarr: Object.fromEntries(
          Object.entries(this.serverLastSuccessfulSyncAt.sonarr).map(
            ([serverId, date]) => [serverId, date.toISOString()]
          )
        ),
      },
      serverStale,
    };
  }

  public getMovieProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.radarrServers[serverId]) {
      return [];
    }

    return this.radarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getSeriesProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.sonarrServers[serverId]) {
      return [];
    }

    return this.sonarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getVideoSnapshot(
    mediaType: MediaType,
    serverId: number,
    externalServiceId: number
  ): HubVideoAcquisitionSnapshot | undefined {
    return (
      mediaType === MediaType.MOVIE
        ? this.radarrCatalog[serverId]
        : this.sonarrCatalog[serverId]
    )?.[externalServiceId];
  }

  public async resetDownloadTracker() {
    this.radarrServers = {};
    this.sonarrServers = {};
    this.radarrCatalog = {};
    this.sonarrCatalog = {};
    this.lastAttemptAt = undefined;
    this.lastSuccessfulSyncAt = undefined;
    this.providerHealth = { radarr: false, sonarr: false, sabnzbd: false };
    this.providerLastSuccessfulSyncAt = {};
    this.serverHealth = { radarr: {}, sonarr: {} };
    this.serverLastSuccessfulSyncAt = { radarr: {}, sonarr: {} };
  }

  public async updateDownloads(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    this.lastAttemptAt = new Date();
    try {
      let sabQueue = new Map<string, SabQueueSlot>();
      try {
        sabQueue = await getSabQueue();
        this.providerHealth.sabnzbd = true;
        this.providerLastSuccessfulSyncAt.sabnzbd = new Date();
      } catch {
        this.providerHealth.sabnzbd = false;
      }
      const issueRequests = await findActiveServarrIssueRequests();
      const results = await Promise.allSettled([
        this.updateRadarrDownloads(sabQueue, issueRequests),
        this.updateSonarrDownloads(sabQueue, issueRequests),
      ]);
      this.providerHealth.radarr = results[0].status === 'fulfilled';
      this.providerHealth.sonarr = results[1].status === 'fulfilled';
      const completedAt = new Date();
      if (this.providerHealth.radarr) {
        this.providerLastSuccessfulSyncAt.radarr = completedAt;
      }
      if (this.providerHealth.sonarr) {
        this.providerLastSuccessfulSyncAt.sonarr = completedAt;
      }
      if (
        results.every((result) => result.status === 'fulfilled') &&
        this.providerHealth.sabnzbd
      ) {
        this.lastSuccessfulSyncAt = new Date();
      }
      this.sabSizeLeft = new Map(
        [...sabQueue.entries()].flatMap(([id, slot]) =>
          slot.sizeLeft === undefined ? [] : [[id, slot.sizeLeft]]
        )
      );
      await processTorrentFallbacks().catch((error) =>
        logger.error('Automatic torrent fallback pass failed', {
          label: 'Torrent Fallback',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      this.updating = false;
    }
  }

  private markServerResult(
    provider: 'radarr' | 'sonarr',
    serverIds: number[],
    healthy: boolean
  ): void {
    const completedAt = new Date();
    serverIds.forEach((serverId) => {
      this.serverHealth[provider][serverId] = healthy;
      if (healthy) {
        this.serverLastSuccessfulSyncAt[provider][serverId] = completedAt;
      }
    });
  }

  private async updateRadarrDownloads(
    sabQueue: Map<string, SabQueueSlot>,
    issueRequests: MediaRequest[]
  ) {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.radarr, (radarrA, radarrB) => {
      return (
        radarrA.hostname === radarrB.hostname &&
        radarrA.port === radarrB.port &&
        radarrA.baseUrl === radarrB.baseUrl
      );
    });

    // Load downloads from Radarr servers
    await Promise.all(
      filteredServers.map(async (server) => {
        if (server.syncEnabled) {
          const matchingServers = settings.radarr.filter(
            (candidate) =>
              candidate.hostname === server.hostname &&
              candidate.port === server.port &&
              candidate.baseUrl === server.baseUrl &&
              candidate.id !== server.id
          );
          const mirroredServerIds = [
            server.id,
            ...matchingServers
              .filter((candidate) => candidate.syncEnabled)
              .map((candidate) => candidate.id),
          ];
          const radarr = new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            const [queueItems, history, movies] = await Promise.all([
              radarr.getQueue(),
              radarr.getRecentHistory(),
              radarr.getMovies(),
            ]);

            this.radarrServers[server.id] = queueItems.map((item, index) => ({
              externalId: item.movieId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.MOVIE,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
              downloadId: item.downloadId,
              trackedDownloadStatus: item.trackedDownloadStatus,
              trackedDownloadState: item.trackedDownloadState,
              protocol: item.protocol,
              downloadClient: item.downloadClient,
              clientStatus: sabQueue.get(item.downloadId)?.status,
              clientActive: this.isSabSlotActive(
                item.downloadId,
                sabQueue.get(item.downloadId)
              ),
              queuePosition:
                sabQueue.get(item.downloadId)?.position ?? index + 1,
              statusMessages: item.statusMessages,
              source: 'radarr',
            }));
            await persistServarrQueueIssues(
              'radarr',
              server.id,
              this.radarrServers[server.id],
              issueRequests
            );
            await persistServarrHistoryIssues(
              'radarr',
              server.id,
              history,
              issueRequests
            );
            this.radarrCatalog[server.id] = Object.fromEntries(
              movies.map((movie) => [
                movie.id,
                {
                  availability: movie.hasFile ? 'imported' : 'missing',
                  waitingForRelease: !movie.isAvailable,
                  requested: 1,
                  imported: movie.hasFile ? 1 : 0,
                  queued: queueItems.some((item) => item.movieId === movie.id)
                    ? 1
                    : 0,
                  failed: queueItems.some(
                    (item) =>
                      item.movieId === movie.id &&
                      /fail|error|warn/i.test(
                        `${item.status} ${item.trackedDownloadStatus} ${item.trackedDownloadState}`
                      )
                  )
                    ? 1
                    : 0,
                },
              ])
            );

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Radarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
            this.markServerResult('radarr', mirroredServerIds, true);
          } catch (error) {
            this.markServerResult('radarr', mirroredServerIds, false);
            logger.error(
              `Unable to get queue from Radarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
            throw error;
          }

          // Duplicate this data to matching servers
          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Radarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.radarrServers[ms.id] = this.radarrServers[server.id];
              this.radarrCatalog[ms.id] = this.radarrCatalog[server.id];
            }
          });
        }
      })
    );
  }

  private async updateSonarrDownloads(
    sabQueue: Map<string, SabQueueSlot>,
    issueRequests: MediaRequest[]
  ) {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.sonarr, (sonarrA, sonarrB) => {
      return (
        sonarrA.hostname === sonarrB.hostname &&
        sonarrA.port === sonarrB.port &&
        sonarrA.baseUrl === sonarrB.baseUrl
      );
    });

    // Load downloads from Sonarr servers
    await Promise.all(
      filteredServers.map(async (server) => {
        if (server.syncEnabled) {
          const matchingServers = settings.sonarr.filter(
            (candidate) =>
              candidate.hostname === server.hostname &&
              candidate.port === server.port &&
              candidate.baseUrl === server.baseUrl &&
              candidate.id !== server.id
          );
          const mirroredServerIds = [
            server.id,
            ...matchingServers
              .filter((candidate) => candidate.syncEnabled)
              .map((candidate) => candidate.id),
          ];
          const sonarr = new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            const [queueItems, history, series] = await Promise.all([
              sonarr.getQueue(),
              sonarr.getRecentHistory(),
              sonarr.getSeries(),
            ]);
            const requestedSeriesIds = new Set(
              issueRequests.flatMap((request) => {
                const requestServiceId =
                  request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
                const requestExternalId =
                  request.media[
                    request.is4k ? 'externalServiceId4k' : 'externalServiceId'
                  ];
                return request.type === MediaType.TV &&
                  requestServiceId != null &&
                  mirroredServerIds.includes(requestServiceId) &&
                  requestExternalId != null
                  ? [requestExternalId]
                  : [];
              })
            );
            const failedSeriesIds = [
              ...new Set(
                history.flatMap((event) =>
                  /fail/i.test(event.eventType) &&
                  event.seriesId != null &&
                  requestedSeriesIds.has(event.seriesId)
                    ? [event.seriesId]
                    : []
                )
              ),
            ];
            const episodeStates = new Map(
              await mapWithLimit(
                failedSeriesIds,
                4,
                async (seriesId): Promise<[number, EpisodeResult[]]> => [
                  seriesId,
                  await sonarr.getEpisodes(seriesId),
                ]
              )
            );

            this.sonarrServers[server.id] = queueItems.map((item, index) => ({
              externalId: item.seriesId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.TV,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
              episode: item.episode,
              downloadId: item.downloadId,
              trackedDownloadStatus: item.trackedDownloadStatus,
              trackedDownloadState: item.trackedDownloadState,
              protocol: item.protocol,
              downloadClient: item.downloadClient,
              clientStatus: sabQueue.get(item.downloadId)?.status,
              clientActive: this.isSabSlotActive(
                item.downloadId,
                sabQueue.get(item.downloadId)
              ),
              queuePosition:
                sabQueue.get(item.downloadId)?.position ?? index + 1,
              statusMessages: item.statusMessages,
              source: 'sonarr',
            }));
            await persistServarrQueueIssues(
              'sonarr',
              server.id,
              this.sonarrServers[server.id],
              issueRequests
            );
            await persistServarrHistoryIssues(
              'sonarr',
              server.id,
              history,
              issueRequests,
              episodeStates,
              this.sonarrServers[server.id]
            );
            this.sonarrCatalog[server.id] = Object.fromEntries(
              series
                .filter((item) => item.id != null)
                .map((item) => {
                  const monitoredSeasons = item.seasons.filter(
                    (season) => season.monitored && season.seasonNumber >= 0
                  );
                  const requested = monitoredSeasons.reduce(
                    (sum, season) =>
                      sum +
                      Number(
                        season.statistics?.episodeCount ??
                          season.statistics?.totalEpisodeCount ??
                          0
                      ),
                    0
                  );
                  const imported = monitoredSeasons.reduce(
                    (sum, season) =>
                      sum + Number(season.statistics?.episodeFileCount ?? 0),
                    0
                  );
                  const matchingQueue = queueItems.filter(
                    (queueItem) => queueItem.seriesId === item.id
                  );
                  const seasons = Object.fromEntries(
                    monitoredSeasons.map((season) => {
                      const seasonQueue = matchingQueue.filter(
                        (queueItem) =>
                          queueItem.episode?.seasonNumber ===
                          season.seasonNumber
                      );
                      return [
                        season.seasonNumber,
                        {
                          requested: Number(
                            season.statistics?.episodeCount ??
                              season.statistics?.totalEpisodeCount ??
                              0
                          ),
                          imported: Number(
                            season.statistics?.episodeFileCount ?? 0
                          ),
                          queued: new Set(
                            seasonQueue.map(
                              (queueItem) => queueItem.episode?.episodeNumber
                            )
                          ).size,
                          failed: seasonQueue.filter((queueItem) =>
                            /fail|error|warn/i.test(
                              `${queueItem.status} ${queueItem.trackedDownloadStatus} ${queueItem.trackedDownloadState}`
                            )
                          ).length,
                        },
                      ];
                    })
                  );
                  return [
                    item.id!,
                    {
                      availability:
                        requested > 0 && imported >= requested
                          ? 'imported'
                          : imported > 0
                            ? 'partial'
                            : 'missing',
                      waitingForRelease: false,
                      requested,
                      imported,
                      queued: new Set(
                        matchingQueue.map((queueItem) => queueItem.episode?.id)
                      ).size,
                      failed: matchingQueue.filter((queueItem) =>
                        /fail|error|warn/i.test(
                          `${queueItem.status} ${queueItem.trackedDownloadStatus} ${queueItem.trackedDownloadState}`
                        )
                      ).length,
                      seasons,
                    },
                  ];
                })
            );

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Sonarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
            this.markServerResult('sonarr', mirroredServerIds, true);
          } catch (error) {
            this.markServerResult('sonarr', mirroredServerIds, false);
            logger.error(
              `Unable to get queue from Sonarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
            throw error;
          }

          // Duplicate this data to matching servers
          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Sonarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.sonarrServers[ms.id] = this.sonarrServers[server.id];
              this.sonarrCatalog[ms.id] = this.sonarrCatalog[server.id];
            }
          });
        }
      })
    );
  }

  private isSabSlotActive(
    downloadId: string,
    slot: SabQueueSlot | undefined
  ): boolean | undefined {
    if (!slot) return undefined;
    if (!/download/i.test(slot.status)) return false;
    const previous = this.sabSizeLeft.get(downloadId);
    return (
      slot.position === 1 ||
      (previous !== undefined &&
        slot.sizeLeft !== undefined &&
        slot.sizeLeft < previous)
    );
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
