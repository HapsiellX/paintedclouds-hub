import type { DownloadingItem } from '@server/lib/downloadtracker';

export interface HubDownloadEpisode {
  seasonNumber: number;
  episodeNumber: number;
}

export interface HubDownloadPart {
  progress: number;
  status: string;
  timeLeft?: string;
  estimatedCompletionTime?: string;
  episodes: HubDownloadEpisode[];
}

export interface HubDownloadProgress {
  progress: number;
  status: string;
  downloadedBytes: number;
  totalBytes: number;
  episodeCount: number;
  parts: HubDownloadPart[];
}

const progressFor = (item: DownloadingItem): number => {
  if (!Number.isFinite(item.size) || item.size <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round(((item.size - item.sizeLeft) / item.size) * 100))
  );
};

const sizeFor = (item: DownloadingItem): number =>
  Number.isFinite(item.size) ? Math.max(0, item.size) : 0;

const downloadedFor = (item: DownloadingItem): number => {
  const size = sizeFor(item);
  const sizeLeft = Number.isFinite(item.sizeLeft)
    ? Math.max(0, item.sizeLeft)
    : size;
  return Math.max(0, Math.min(size, size - sizeLeft));
};

const publicStatus = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  if (/fail|error/.test(normalized)) return 'failed';
  if (/warn/.test(normalized)) return 'warning';
  if (/pause/.test(normalized)) return 'paused';
  if (/complete|import/.test(normalized)) return 'completed';
  if (/download/.test(normalized)) return 'downloading';
  return 'queued';
};

export const summarizeHubDownloads = (
  downloads: DownloadingItem[] | undefined
): HubDownloadProgress | undefined => {
  if (!downloads?.length) return undefined;

  const grouped = new Map<string, DownloadingItem[]>();
  downloads.forEach((item, index) => {
    const key = item.downloadId || `queue-item-${index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });

  const representatives = [...grouped.values()].map((items) => items[0]);
  const totalBytes = representatives.reduce(
    (total, item) => total + sizeFor(item),
    0
  );
  const downloadedBytes = representatives.reduce(
    (total, item) => total + downloadedFor(item),
    0
  );
  const progress = totalBytes
    ? Math.max(
        0,
        Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      )
    : Math.round(
        representatives.reduce((total, item) => total + progressFor(item), 0) /
          representatives.length
      );

  const parts = [...grouped.values()].map((items) => {
    const item = items[0];
    const episodes = [
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
    );
    const estimatedCompletionTime = Number.isNaN(
      new Date(item.estimatedCompletionTime).getTime()
    )
      ? undefined
      : new Date(item.estimatedCompletionTime).toISOString();

    return {
      progress: progressFor(item),
      status: publicStatus(item.status),
      ...(item.timeLeft ? { timeLeft: item.timeLeft } : {}),
      ...(estimatedCompletionTime ? { estimatedCompletionTime } : {}),
      episodes,
    };
  });

  return {
    progress,
    status:
      [
        'failed',
        'warning',
        'paused',
        'downloading',
        'queued',
        'completed',
      ].find((status) => parts.some((part) => part.status === status)) ??
      'queued',
    downloadedBytes,
    totalBytes,
    episodeCount: parts.reduce(
      (total, part) => total + part.episodes.length,
      0
    ),
    parts,
  };
};
