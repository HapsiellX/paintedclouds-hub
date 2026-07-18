import useLocale from '@app/hooks/useLocale';
import type { HubDownloadProgress } from '@server/lib/hub/downloadProgress';

interface DownloadProgressProps {
  progress: HubDownloadProgress;
  detailed?: boolean;
}

const DownloadProgress = ({
  progress,
  detailed = false,
}: DownloadProgressProps) => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const statusLabels: Record<string, string> = {
    downloading: tr('Wird heruntergeladen', 'Downloading'),
    queued: tr('In der Warteschlange', 'Queued'),
    paused: tr('Pausiert', 'Paused'),
    completed: tr('Abgeschlossen', 'Completed'),
    warning: tr('Hinweis erforderlich', 'Attention required'),
    failed: tr('Fehlgeschlagen', 'Failed'),
  };
  const byteFormat = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1,
  });
  const gigabytes = (bytes: number) => byteFormat.format(bytes / 1_000_000_000);
  const episodeLabel = (seasonNumber: number, episodeNumber: number) =>
    `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;

  return (
    <div className={detailed ? 'space-y-3' : 'mt-3'}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-300">
        <span>
          {statusLabels[progress.status] ?? progress.status} ·{' '}
          {progress.progress}%
          {progress.episodeCount
            ? ` · ${progress.episodeCount} ${
                progress.episodeCount === 1
                  ? tr('Folge', 'episode')
                  : tr('Folgen', 'episodes')
              }`
            : ''}
        </span>
        {progress.totalBytes > 0 && (
          <span>
            {gigabytes(progress.downloadedBytes)} /{' '}
            {gigabytes(progress.totalBytes)}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={tr('Download-Fortschritt', 'Download progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.progress}
        aria-valuetext={`${progress.progress}%`}
        className="h-3 overflow-hidden rounded-full bg-gray-700"
      >
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progress.progress}%` }}
        />
      </div>

      {detailed && progress.parts.length > 0 && (
        <ul className="space-y-2">
          {progress.parts.map((part, index) => (
            <li
              key={`${part.estimatedCompletionTime ?? 'part'}-${index}`}
              className="rounded-lg bg-gray-900/60 p-2"
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-300">
                <span className="truncate">
                  {part.episodes.length
                    ? part.episodes
                        .map((episode) =>
                          episodeLabel(
                            episode.seasonNumber,
                            episode.episodeNumber
                          )
                        )
                        .join(', ')
                    : `${tr('Download', 'Download')} ${index + 1}`}
                </span>
                <span className="flex-none">
                  {part.progress}%
                  {part.timeLeft
                    ? ` · ${tr('noch', 'left')} ${part.timeLeft}`
                    : ''}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={
                  part.episodes.length
                    ? part.episodes
                        .map((episode) =>
                          episodeLabel(
                            episode.seasonNumber,
                            episode.episodeNumber
                          )
                        )
                        .join(', ')
                    : `${tr('Download', 'Download')} ${index + 1}`
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={part.progress}
                className="h-2 overflow-hidden rounded-full bg-gray-700"
              >
                <div
                  className="h-full rounded-full bg-indigo-400 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${part.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DownloadProgress;
