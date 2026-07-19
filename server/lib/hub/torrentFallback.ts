import type { ServarrRelease } from '@server/api/servarr/base';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import { MediaRequest } from '@server/entity/MediaRequest';
import { decryptHubSecret } from '@server/lib/hub/secrets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import { isIP } from 'net';
import { IsNull, LessThanOrEqual } from 'typeorm';
import { episodeForPartKey } from './acquisitionStatus';

type FallbackStatus =
  | 'vpn_blocked'
  | 'unsupported'
  | 'no_torrent_found'
  | 'torrent_grabbed'
  | 'grab_failed';

interface VpnGateResult {
  safe: boolean;
  country?: string;
  reason?: string;
}

const isPublicIp = (value: string): boolean => {
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return !(
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  return false;
};

export const selectTorrentRelease = (
  releases: ServarrRelease[],
  minSeeders: number
): ServarrRelease | undefined =>
  releases.find(
    (release) =>
      release.protocol?.toLowerCase() === 'torrent' &&
      release.downloadAllowed !== false &&
      release.rejected !== true &&
      (release.rejections?.length ?? 0) === 0 &&
      Number(release.seeders ?? 0) >= minSeeders
  );

export const checkVpnGate = async (): Promise<VpnGateResult> => {
  const config = getSettings().hub.torrentFallback;
  if (!config?.enabled || !config.vpnGateUrl || !config.apiKey) {
    return { safe: false, reason: 'not_configured' };
  }
  try {
    const headers = {
      'X-API-Key': decryptHubSecret(config.apiKey, 'torrent-fallback-api-key'),
    };
    const base = config.vpnGateUrl.replace(/\/$/, '');
    const [statusResponse, ipResponse] = await Promise.all([
      axios.get<{ status?: string }>(`${base}/v1/vpn/status`, {
        headers,
        timeout: 5_000,
        maxRedirects: 0,
      }),
      axios.get<{ public_ip?: string }>(`${base}/v1/publicip/ip`, {
        headers,
        timeout: 5_000,
        maxRedirects: 0,
      }),
    ]);
    const publicIp = String(ipResponse.data.public_ip ?? '').trim();
    if (statusResponse.data.status !== 'running' || !isPublicIp(publicIp)) {
      return { safe: false, reason: 'vpn_not_running' };
    }
    const geoResponse = await axios.get<{
      success?: boolean;
      country_code?: string;
    }>(`https://ipwho.is/${encodeURIComponent(publicIp)}`, {
      params: { fields: 'success,country_code' },
      timeout: 5_000,
      maxRedirects: 0,
    });
    const country = String(geoResponse.data.country_code ?? '').toUpperCase();
    if (
      geoResponse.data.success !== true ||
      !config.allowedExitCountries.includes(country)
    ) {
      return {
        safe: false,
        country: country || undefined,
        reason: 'exit_country',
      };
    }
    return { safe: true, country };
  } catch {
    return { safe: false, reason: 'gate_unreachable' };
  }
};

const setFallbackState = async (
  issue: HubAcquisitionIssue,
  status: FallbackStatus,
  country?: string
): Promise<void> => {
  await getRepository(HubAcquisitionIssue).update(
    { id: issue.id, resolvedAt: IsNull() },
    {
      torrentFallbackAttemptedAt: new Date(),
      torrentFallbackStatus: status,
      torrentFallbackCountry: country ?? null,
    }
  );
};

const grabForIssue = async (
  issue: HubAcquisitionIssue,
  country: string
): Promise<void> => {
  const request = await getRepository(MediaRequest).findOneBy({
    id: issue.requestId,
  });
  if (!request) {
    await setFallbackState(issue, 'unsupported', country);
    return;
  }
  const serviceId = request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
  const externalServiceId =
    request.media[request.is4k ? 'externalServiceId4k' : 'externalServiceId'];
  if (serviceId == null || externalServiceId == null) {
    await setFallbackState(issue, 'unsupported', country);
    return;
  }
  const minSeeders = getSettings().hub.torrentFallback.minSeeders;
  let releases: ServarrRelease[] = [];
  let grab: ((release: ServarrRelease) => Promise<void>) | undefined;
  if (request.type === MediaType.MOVIE) {
    const server = getSettings().radarr.find(
      (candidate) => candidate.id === serviceId
    );
    if (server) {
      const radarr = new RadarrAPI({
        apiKey: server.apiKey,
        url: RadarrAPI.buildUrl(server, '/api/v3'),
      });
      releases = await radarr.getReleases({ movieId: externalServiceId });
      grab = (release) => radarr.grabRelease(release);
    }
  } else if (request.type === MediaType.TV) {
    const server = getSettings().sonarr.find(
      (candidate) => candidate.id === serviceId
    );
    if (server) {
      const sonarr = new SonarrAPI({
        apiKey: server.apiKey,
        url: SonarrAPI.buildUrl(server, '/api/v3'),
      });
      const requestedEpisode = episodeForPartKey(issue.partKey);
      const episodes = await sonarr.getEpisodes(externalServiceId);
      const episode = requestedEpisode
        ? episodes.find(
            (candidate) =>
              candidate.seasonNumber === requestedEpisode.seasonNumber &&
              candidate.episodeNumber === requestedEpisode.episodeNumber
          )
        : episodes.find(
            (candidate) =>
              candidate.monitored &&
              !candidate.hasFile &&
              (!candidate.airDateUtc ||
                new Date(candidate.airDateUtc).getTime() <= Date.now())
          );
      if (episode) {
        releases = await sonarr.getReleases({ episodeId: episode.id });
        grab = (release) => sonarr.grabRelease(release);
      }
    }
  }
  if (!grab) {
    await setFallbackState(issue, 'unsupported', country);
    return;
  }
  const release = selectTorrentRelease(releases, minSeeders);
  if (!release) {
    await setFallbackState(issue, 'no_torrent_found', country);
    return;
  }
  await grab(release);
  await setFallbackState(issue, 'torrent_grabbed', country);
  logger.info('VPN-gated torrent fallback submitted to Servarr', {
    label: 'Torrent Fallback',
    issueId: issue.id,
    requestId: issue.requestId,
    mediaType: request.type,
    country,
    seeders: release.seeders,
  });
};

let processing: Promise<void> | undefined;

export const processTorrentFallbacks = async (): Promise<void> => {
  if (processing) return processing;
  processing = (async () => {
    const config = getSettings().hub.torrentFallback;
    if (!config?.enabled) return;
    const cutoff = new Date(
      Date.now() - config.retryCooldownMinutes * 60 * 1_000
    );
    const issues = await getRepository(HubAcquisitionIssue).find({
      where: [
        {
          requestSource: 'seerr',
          resolvedAt: IsNull(),
          retryable: true,
          torrentFallbackAttemptedAt: IsNull(),
        },
        {
          requestSource: 'seerr',
          resolvedAt: IsNull(),
          retryable: true,
          torrentFallbackAttemptedAt: LessThanOrEqual(cutoff),
        },
      ],
      order: { updatedAt: 'ASC' },
      take: 5,
    });
    if (!issues.length) return;
    const vpn = await checkVpnGate();
    if (!vpn.safe || !vpn.country) {
      await Promise.all(
        issues.map((issue) =>
          setFallbackState(issue, 'vpn_blocked', vpn.country)
        )
      );
      logger.warn('Torrent fallback blocked by VPN safety gate', {
        label: 'Torrent Fallback',
        reason: vpn.reason,
        country: vpn.country,
        issueCount: issues.length,
      });
      return;
    }
    for (const issue of issues) {
      try {
        await grabForIssue(issue, vpn.country);
      } catch {
        await setFallbackState(issue, 'grab_failed', vpn.country);
      }
    }
  })().finally(() => {
    processing = undefined;
  });
  return processing;
};
