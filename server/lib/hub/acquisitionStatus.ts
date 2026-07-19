import type { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import type { DownloadingItem } from '@server/lib/downloadtracker';

export type HubAcquisitionPhase =
  | 'waiting_for_release'
  | 'searching'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'repairing'
  | 'verifying'
  | 'extracting'
  | 'import_pending'
  | 'importing'
  | 'partially_available'
  | 'available'
  | 'failed'
  | 'unknown';

export type HubAcquisitionHealth = 'ok' | 'warning' | 'error' | 'stale';
export type HubAvailability = 'missing' | 'partial' | 'imported' | 'available';
export type HubAcquisitionSource =
  | 'sabnzbd'
  | 'sonarr'
  | 'radarr'
  | 'lidarr'
  | 'lazylibrarian';

export interface HubAcquisitionCounts {
  requested?: number;
  queued?: number;
  imported?: number;
  failed?: number;
}

export interface HubAcquisitionPart {
  phase: HubAcquisitionPhase;
  health: HubAcquisitionHealth;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  queuePosition?: number;
  timeLeft?: string;
  estimatedCompletionTime?: string;
  episodes: { seasonNumber: number; episodeNumber: number }[];
  reasonCode?: string;
}

export interface HubAcquisitionIssueDto {
  id: number;
  reasonCode: string;
  message: string;
  retryable: boolean;
  acknowledged: boolean;
  episodes: { seasonNumber: number; episodeNumber: number }[];
}

export interface HubAcquisition {
  phase: HubAcquisitionPhase;
  health: HubAcquisitionHealth;
  availability: HubAvailability;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  queuePosition?: number;
  timeLeft?: string;
  estimatedCompletionTime?: string;
  updatedAt: string;
  stale: boolean;
  sources: HubAcquisitionSource[];
  counts?: HubAcquisitionCounts;
  parts: HubAcquisitionPart[];
  issue?: HubAcquisitionIssueDto;
}

export const canonicalEpisodePartKey = (
  seasonNumber: number,
  episodeNumber: number
): string =>
  `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(
    2,
    '0'
  )}`;

export const episodeForPartKey = (
  partKey: string
): { seasonNumber: number; episodeNumber: number } | undefined => {
  const match = /^S(\d+)E(\d+)$/.exec(partKey);
  return match
    ? { seasonNumber: Number(match[1]), episodeNumber: Number(match[2]) }
    : undefined;
};

const clampProgress = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

const sizeFor = (item: DownloadingItem): number =>
  Number.isFinite(item.size) ? Math.max(0, item.size) : 0;

const downloadedFor = (item: DownloadingItem): number => {
  const size = sizeFor(item);
  const left = Number.isFinite(item.sizeLeft)
    ? Math.max(0, Math.min(size, item.sizeLeft))
    : size;
  return size - left;
};

export const normalizeAcquisitionPhase = (
  item: Pick<
    DownloadingItem,
    | 'status'
    | 'clientStatus'
    | 'clientActive'
    | 'trackedDownloadState'
    | 'trackedDownloadStatus'
  >
): {
  phase: HubAcquisitionPhase;
  health: HubAcquisitionHealth;
  reasonCode?: string;
} => {
  const raw = [
    item.clientStatus,
    item.trackedDownloadState,
    item.trackedDownloadStatus,
    item.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/fail|error/.test(raw))
    return { phase: 'failed', health: 'error', reasonCode: 'download_failed' };
  if (/warn/.test(raw))
    return {
      phase: 'failed',
      health: 'warning',
      reasonCode: 'provider_warning',
    };
  if (/pause/.test(raw)) return { phase: 'paused', health: 'warning' };
  if (/repair/.test(raw)) return { phase: 'repairing', health: 'ok' };
  if (/verif|check/.test(raw)) return { phase: 'verifying', health: 'ok' };
  if (/unpack|extract/.test(raw)) return { phase: 'extracting', health: 'ok' };
  if (/importpending|import pending/.test(raw))
    return { phase: 'import_pending', health: 'ok' };
  if (/import/.test(raw)) return { phase: 'importing', health: 'ok' };
  if (item.clientStatus && item.clientActive === false)
    return { phase: 'queued', health: 'ok' };
  if (/download/.test(raw)) return { phase: 'downloading', health: 'ok' };
  return { phase: 'queued', health: 'ok' };
};

const phasePriority: HubAcquisitionPhase[] = [
  'failed',
  'paused',
  'repairing',
  'verifying',
  'extracting',
  'import_pending',
  'importing',
  'downloading',
  'queued',
  'searching',
  'waiting_for_release',
  'partially_available',
  'available',
  'unknown',
];

export const acquisitionIssueDto = (
  issue: HubAcquisitionIssue
): HubAcquisitionIssueDto => {
  const episode = episodeForPartKey(issue.partKey);
  return {
    id: issue.id,
    reasonCode: issue.reasonCode,
    message: issue.message,
    retryable: issue.retryable,
    acknowledged: Boolean(issue.acknowledgedAt),
    episodes: episode ? [episode] : [],
  };
};

export const summarizeHubAcquisition = ({
  downloads,
  availability = 'missing',
  fallbackPhase = 'searching',
  counts,
  updatedAt = new Date(),
  stale = false,
  issue,
}: {
  downloads?: DownloadingItem[];
  availability?: HubAvailability;
  fallbackPhase?: HubAcquisitionPhase;
  counts?: HubAcquisitionCounts;
  updatedAt?: Date;
  stale?: boolean;
  issue?: HubAcquisitionIssue;
}): HubAcquisition => {
  const grouped = new Map<string, DownloadingItem[]>();
  downloads?.forEach((item, index) => {
    const key = item.downloadId || `part-${index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  const parts: HubAcquisitionPart[] = [...grouped.values()].map((items) => {
    const item = items[0];
    const normalized = normalizeAcquisitionPhase(item);
    const totalBytes = sizeFor(item);
    const downloadedBytes = downloadedFor(item);
    const estimated = new Date(item.estimatedCompletionTime);
    return {
      ...normalized,
      progress: totalBytes
        ? clampProgress((downloadedBytes / totalBytes) * 100)
        : 0,
      downloadedBytes,
      totalBytes,
      ...(item.queuePosition ? { queuePosition: item.queuePosition } : {}),
      ...(item.timeLeft ? { timeLeft: item.timeLeft } : {}),
      ...(!Number.isNaN(estimated.getTime())
        ? { estimatedCompletionTime: estimated.toISOString() }
        : {}),
      episodes: [
        ...new Map(
          items
            .filter((candidate) => candidate.episode)
            .map((candidate) => [
              `${candidate.episode!.seasonNumber}:${candidate.episode!.episodeNumber}`,
              {
                seasonNumber: candidate.episode!.seasonNumber,
                episodeNumber: candidate.episode!.episodeNumber,
              },
            ])
        ).values(),
      ].sort(
        (a, b) =>
          a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
      ),
    };
  });
  const totalBytes = parts.reduce((sum, part) => sum + part.totalBytes, 0);
  const downloadedBytes = parts.reduce(
    (sum, part) => sum + part.downloadedBytes,
    0
  );
  const phase =
    phasePriority.find((candidate) =>
      parts.some((part) => part.phase === candidate)
    ) ?? (issue ? 'failed' : fallbackPhase);
  const health: HubAcquisitionHealth = stale
    ? 'stale'
    : issue
      ? 'error'
      : parts.some((part) => part.health === 'error')
        ? 'error'
        : parts.some((part) => part.health === 'warning')
          ? 'warning'
          : 'ok';
  const sources = [
    ...new Set(
      (downloads ?? []).flatMap((item) => [
        ...(item.clientStatus ? (['sabnzbd'] as const) : []),
        item.source ?? (item.mediaType === 'movie' ? 'radarr' : 'sonarr'),
      ])
    ),
  ];
  return {
    phase,
    health,
    availability,
    progress: totalBytes
      ? clampProgress((downloadedBytes / totalBytes) * 100)
      : availability === 'available'
        ? 100
        : 0,
    downloadedBytes,
    totalBytes,
    ...(parts.map((part) => part.queuePosition).filter(Boolean)[0]
      ? {
          queuePosition: parts
            .map((part) => part.queuePosition)
            .filter(Boolean)[0],
        }
      : {}),
    ...(parts.find((part) => part.timeLeft)?.timeLeft
      ? { timeLeft: parts.find((part) => part.timeLeft)?.timeLeft }
      : {}),
    ...(parts.find((part) => part.estimatedCompletionTime)
      ?.estimatedCompletionTime
      ? {
          estimatedCompletionTime: parts.find(
            (part) => part.estimatedCompletionTime
          )?.estimatedCompletionTime,
        }
      : {}),
    updatedAt: updatedAt.toISOString(),
    stale,
    sources,
    ...(counts ? { counts } : {}),
    parts,
    ...(issue ? { issue: acquisitionIssueDto(issue) } : {}),
  };
};
