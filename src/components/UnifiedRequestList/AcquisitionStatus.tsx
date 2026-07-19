import useLocale from '@app/hooks/useLocale';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PauseCircleIcon,
} from '@heroicons/react/24/outline';
import { formatAcquisitionIssueMessage } from '@server/lib/hub/acquisitionIssueMessage';
import type {
  HubAcquisition,
  HubAcquisitionHealth,
  HubAcquisitionPhase,
} from '@server/lib/hub/acquisitionStatus';

export type Acquisition = HubAcquisition;
type AcquisitionPhase = HubAcquisitionPhase;
type AcquisitionHealth = HubAcquisitionHealth;

export type AcquisitionGroup =
  | 'downloading'
  | 'queued'
  | 'processing'
  | 'paused'
  | 'problems';

export const acquisitionGroupFor = (
  acquisition: Acquisition
): AcquisitionGroup => {
  if (acquisition.phase === 'failed' || acquisition.health === 'error') {
    return 'problems';
  }
  if (acquisition.phase === 'paused') return 'paused';
  if (
    acquisition.phase === 'unknown' ||
    acquisition.health === 'warning' ||
    acquisition.health === 'stale' ||
    acquisition.stale
  ) {
    return 'problems';
  }
  if (
    [
      'repairing',
      'verifying',
      'extracting',
      'import_pending',
      'importing',
    ].includes(acquisition.phase)
  ) {
    return 'processing';
  }
  if (acquisition.phase === 'downloading') {
    return 'downloading';
  }
  return 'queued';
};

const phaseTone = (phase: AcquisitionPhase, health: AcquisitionHealth) => {
  if (phase === 'failed' || health === 'error') {
    return {
      badge: 'border-red-700 bg-red-950/70 text-red-200',
      bar: 'bg-red-500',
      Icon: ExclamationTriangleIcon,
    };
  }
  if (phase === 'paused') {
    return {
      badge: 'border-gray-500 bg-gray-800 text-gray-100',
      bar: 'bg-gray-400',
      Icon: PauseCircleIcon,
    };
  }
  if (health === 'warning' || health === 'stale' || phase === 'unknown') {
    return {
      badge: 'border-amber-600 bg-amber-950/70 text-amber-100',
      bar: 'bg-amber-400',
      Icon: ExclamationTriangleIcon,
    };
  }
  if (phase === 'available') {
    return {
      badge: 'border-emerald-700 bg-emerald-950/70 text-emerald-100',
      bar: 'bg-emerald-400',
      Icon: CheckCircleIcon,
    };
  }
  if (
    [
      'repairing',
      'verifying',
      'extracting',
      'import_pending',
      'importing',
    ].includes(phase)
  ) {
    return {
      badge: 'border-cyan-700 bg-cyan-950/70 text-cyan-100',
      bar: 'bg-cyan-400',
      Icon: ArrowPathIcon,
    };
  }
  if (phase === 'downloading' || phase === 'partially_available') {
    return {
      badge: 'border-indigo-600 bg-indigo-950/70 text-indigo-100',
      bar: 'bg-indigo-400',
      Icon: ArrowDownTrayIcon,
    };
  }
  if (phase === 'searching') {
    return {
      badge: 'border-violet-700 bg-violet-950/70 text-violet-100',
      bar: 'bg-violet-400',
      Icon: MagnifyingGlassIcon,
    };
  }
  return {
    badge: 'border-gray-600 bg-gray-900 text-gray-100',
    bar: 'bg-gray-300',
    Icon: ClockIcon,
  };
};

interface AcquisitionStatusProps {
  acquisition: Acquisition;
  title: string;
  isVideo: boolean;
  detailed?: boolean;
}

const AcquisitionStatus = ({
  acquisition,
  title,
  isVideo,
  detailed = false,
}: AcquisitionStatusProps) => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const phaseLabels: Record<AcquisitionPhase, string> = {
    waiting_for_release: tr(
      'Wartet auf Veröffentlichung',
      'Waiting for release'
    ),
    searching: tr('Suche läuft', 'Searching'),
    queued: tr('In der Warteschlange', 'Queued'),
    downloading: tr('Wird heruntergeladen', 'Downloading'),
    paused: tr('Pausiert', 'Paused'),
    repairing: tr('Wird repariert', 'Repairing'),
    verifying: tr('Wird geprüft', 'Verifying'),
    extracting: tr('Wird entpackt', 'Extracting'),
    import_pending: tr('Import steht aus', 'Import pending'),
    importing: tr('Wird importiert', 'Importing'),
    partially_available: tr('Teilweise verfügbar', 'Partially available'),
    available: tr('In der Bibliothek verfügbar', 'Available in the library'),
    failed: tr('Fehlgeschlagen', 'Failed'),
    unknown: tr('Status derzeit unbekannt', 'Status currently unknown'),
  };
  const byteFormat = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1,
  });
  const gigabytes = (bytes: number) => byteFormat.format(bytes / 1_000_000_000);
  const episodeLabel = (seasonNumber: number, episodeNumber: number) =>
    `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
  const phaseLabel = phaseLabels[acquisition.phase];
  const tone = phaseTone(acquisition.phase, acquisition.health);
  const availabilityLabel = (() => {
    if (
      acquisition.availability === 'available' ||
      acquisition.phase === 'available'
    ) {
      return isVideo
        ? tr('In Jellyfin verfügbar', 'Available in Jellyfin')
        : tr('Im Zielsystem verfügbar', 'Available in the target system');
    }
    if (
      acquisition.availability === 'partial' ||
      acquisition.phase === 'partially_available'
    ) {
      return isVideo
        ? tr(
            'Teilweise in Jellyfin verfügbar',
            'Partially available in Jellyfin'
          )
        : tr(
            'Teilweise im Zielsystem verfügbar',
            'Partially available in the target system'
          );
    }
    if (acquisition.availability === 'imported') {
      return tr(
        'Importiert, Bibliotheksabgleich läuft',
        'Imported, library sync pending'
      );
    }
    return isVideo
      ? tr('Noch nicht in Jellyfin verfügbar', 'Not yet available in Jellyfin')
      : tr(
          'Noch nicht im Zielsystem verfügbar',
          'Not yet available in the target system'
        );
  })();
  const progressText = [
    `${acquisition.progress}%`,
    acquisition.totalBytes > 0
      ? `${gigabytes(acquisition.downloadedBytes)} ${tr('von', 'of')} ${gigabytes(
          acquisition.totalBytes
        )}`
      : undefined,
    acquisition.timeLeft
      ? `${tr('noch', 'left')} ${acquisition.timeLeft}`
      : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  const showProgress =
    acquisition.totalBytes > 0 ||
    ['downloading', 'repairing', 'verifying', 'extracting'].includes(
      acquisition.phase
    );

  return (
    <div className={detailed ? 'space-y-3' : 'mt-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.badge}`}
        >
          <tone.Icon className="h-4 w-4" aria-hidden="true" />
          {phaseLabel}
        </span>
        {acquisition.queuePosition !== undefined && (
          <span className="text-xs text-gray-300">
            {tr('Platz', 'Position')} {acquisition.queuePosition}
          </span>
        )}
        {acquisition.stale && (
          <span className="text-xs font-medium text-amber-200">
            {tr('Stand möglicherweise veraltet', 'Status may be outdated')}
          </span>
        )}
      </div>

      {showProgress && (
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-300">
            <span>{tr('Übertragungsfortschritt', 'Transfer progress')}</span>
            <span>{progressText}</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${title}: ${tr('Übertragungsfortschritt', 'transfer progress')}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={acquisition.progress}
            aria-valuetext={`${phaseLabel}, ${progressText}`}
            className="h-3 overflow-hidden rounded-full border border-gray-500 bg-gray-800"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${tone.bar}`}
              style={{ width: `${acquisition.progress}%` }}
            />
          </div>
          {acquisition.progress === 100 &&
            !['available', 'partially_available'].includes(
              acquisition.phase
            ) && (
              <p className="mt-1 text-xs text-cyan-100">
                {tr(
                  'Download vollständig – Nachbearbeitung oder Import ist noch nicht abgeschlossen.',
                  'Download complete — post-processing or import is not finished yet.'
                )}
              </p>
            )}
        </div>
      )}

      <p className="text-xs text-gray-300">{availabilityLabel}</p>

      {acquisition.counts?.requested !== undefined && (
        <p className="text-xs text-gray-300">
          {tr('Folgen:', 'Episodes:')} {acquisition.counts.imported ?? 0}{' '}
          {tr('von', 'of')} {acquisition.counts.requested}{' '}
          {tr('importiert', 'imported')}
          {acquisition.counts.queued
            ? ` · ${acquisition.counts.queued} ${tr('in der Warteschlange', 'queued')}`
            : ''}
          {acquisition.counts.failed
            ? ` · ${acquisition.counts.failed} ${tr('fehlgeschlagen', 'failed')}`
            : ''}
        </p>
      )}

      {acquisition.issue && (
        <div className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-100">
          <p>{formatAcquisitionIssueMessage(acquisition.issue, locale)}</p>
          {acquisition.issue.episodes?.length > 0 && (
            <p
              className="mt-1 text-xs text-red-200"
              data-testid="acquisition-issue-episodes"
            >
              {tr('Betroffene Folgen:', 'Affected episodes:')}{' '}
              {acquisition.issue.episodes
                .map((episode) =>
                  episodeLabel(episode.seasonNumber, episode.episodeNumber)
                )
                .join(', ')}
            </p>
          )}
        </div>
      )}

      {detailed &&
        (acquisition.parts.length > 1 ||
          acquisition.parts.some((part) => part.episodes.length > 0)) && (
          <details className="rounded-lg bg-gray-950/50 p-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-200">
              {tr('Einzelne Downloads anzeigen', 'Show individual downloads')} (
              {acquisition.parts.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {acquisition.parts.map((part, index) => {
                const partTone = phaseTone(part.phase, part.health);
                const partName = part.episodes.length
                  ? part.episodes
                      .map((episode) =>
                        episodeLabel(
                          episode.seasonNumber,
                          episode.episodeNumber
                        )
                      )
                      .join(', ')
                  : `${tr('Download', 'Download')} ${index + 1}`;
                return (
                  <li
                    key={`${partName}-${index}`}
                    className="rounded-lg bg-gray-900/80 p-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-300">
                      <span className="truncate">{partName}</span>
                      <span className="flex-none">
                        {phaseLabels[part.phase]} · {part.progress}%
                      </span>
                    </div>
                    {part.totalBytes > 0 && (
                      <div
                        role="progressbar"
                        aria-label={`${title}, ${partName}: ${phaseLabels[part.phase]}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={part.progress}
                        aria-valuetext={`${phaseLabels[part.phase]}, ${part.progress}%`}
                        className="h-2 overflow-hidden rounded-full border border-gray-500 bg-gray-800"
                      >
                        <div
                          className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${partTone.bar}`}
                          style={{ width: `${part.progress}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
    </div>
  );
};

export default AcquisitionStatus;
