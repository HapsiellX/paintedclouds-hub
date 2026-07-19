import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useLocale from '@app/hooks/useLocale';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  MusicalNoteIcon,
  PauseCircleIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import { formatAcquisitionIssueMessage } from '@server/lib/hub/acquisitionIssueMessage';
import { buildHubActivityUrl } from '@server/lib/hub/activityUrl';
import axios from 'axios';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import AcquisitionStatus, {
  acquisitionGroupFor,
  type Acquisition,
  type AcquisitionGroup,
} from './AcquisitionStatus';

type RequestKind = 'movie' | 'tv' | 'music_artist' | 'music_album' | 'book';
type RequestFormat = 'ebook' | 'audiobook';
type RequestSource = 'seerr' | 'hub';

interface UnifiedRequest {
  id: string;
  source: RequestSource;
  sourceId: number;
  kind: RequestKind;
  provider: 'tmdb' | 'musicbrainz' | 'openlibrary';
  externalId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  formats?: RequestFormat[];
  state: string;
  errorMessage?: string;
  requestedBy: { id: number; displayName: string; avatar: string };
  createdAt: string;
  updatedAt: string;
  is4k?: boolean;
  acquisition?: Acquisition;
}

interface AcquisitionQueueItem {
  id: string;
  kind: RequestKind;
  externalId: string;
  title: string;
  imageUrl?: string;
  is4k?: boolean;
  acquisition: Acquisition;
}

interface RecentAcquisitionIssue {
  source: 'seerr' | 'hub';
  requestId: number;
  title: string;
  kind: RequestKind;
  reasonCode: string;
  message: string;
  resolvedAt: string;
  acknowledged: boolean;
}

interface AcquisitionQueue {
  summary: {
    total: number;
    queued: number;
    waitingForRelease: number;
    downloading: number;
    processing: number;
    importPending: number;
    paused: number;
    failed: number;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
  };
  groups: {
    downloading: AcquisitionQueueItem[];
    queued: AcquisitionQueueItem[];
    processing: AcquisitionQueueItem[];
    paused: AcquisitionQueueItem[];
    problems: AcquisitionQueueItem[];
  };
  issues: AcquisitionQueueItem[];
  recentIssues: RecentAcquisitionIssue[];
  observedAt: string;
  lastUpdatedAt?: string;
  stale: boolean;
}

interface ActivityResponse {
  results: UnifiedRequest[];
  take: number;
  skip: number;
  total: number;
  hasMore: boolean;
  totalIsEstimate?: boolean;
  scanExhausted?: boolean;
  nextScanCursor?: number;
  nextSkip?: number;
  acquisitionQueue?: AcquisitionQueue;
}

interface ActivityPageState {
  scanCursor: number;
  skip: number;
}

interface HistoryEvent {
  id: number;
  action: string;
  from?: string;
  to?: string;
  createdAt: string;
  actor?: { displayName: string };
}

const PAGE_SIZE = 20;

const UnifiedRequestList = () => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const { hasPermission } = useUser();
  const admin = hasPermission(Permission.ADMIN);
  const canManageVideo = hasPermission(Permission.MANAGE_REQUESTS);
  const canRetryAcquisition = admin || canManageVideo;
  const [page, setPage] = useState(1);
  const [activityPageState, setActivityPageState] = useState<
    Record<number, ActivityPageState>
  >({ 1: { scanCursor: 0, skip: 0 } });
  const [mediaFilter, setMediaFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [query, debouncedQuery, setQuery] = useDebouncedState('', 350);
  const [historyRequestId, setHistoryRequestId] = useState<number>();
  const [actionError, setActionError] = useState<string>();
  const [acquisitionActionId, setAcquisitionActionId] = useState<number>();
  const [acquisitionActionMessage, setAcquisitionActionMessage] =
    useState<string>();

  const { kinds, formats } = useMemo(() => {
    if (mediaFilter === 'ebook' || mediaFilter === 'audiobook') {
      return { kinds: 'book', formats: mediaFilter };
    }
    return { kinds: mediaFilter, formats: '' };
  }, [mediaFilter]);

  const currentPageState = activityPageState[page] ?? {
    scanCursor: 0,
    skip: 0,
  };

  const activityUrl = buildHubActivityUrl({
    take: PAGE_SIZE,
    skip: currentPageState.skip,
    kinds,
    formats,
    states: stateFilter,
    query: debouncedQuery,
    scanCursor: currentPageState.scanCursor,
  });
  const {
    data,
    error,
    isLoading,
    mutate: refreshActivity,
  } = useSWR<ActivityResponse>(activityUrl, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });
  const acquisitionQueue = data?.acquisitionQueue;
  const acquisitionGroups = useMemo(() => {
    const groups: Record<AcquisitionGroup, AcquisitionQueueItem[]> = {
      downloading: [],
      queued: [],
      processing: [],
      paused: [],
      problems: [],
    };
    if (!acquisitionQueue) return groups;
    const uniqueItems = new Map<string, AcquisitionQueueItem>();
    [
      ...acquisitionQueue.groups.downloading,
      ...acquisitionQueue.groups.queued,
      ...acquisitionQueue.groups.processing,
      ...acquisitionQueue.groups.paused,
      ...acquisitionQueue.groups.problems,
    ].forEach((item) => uniqueItems.set(item.id, item));
    uniqueItems.forEach((item) =>
      groups[acquisitionGroupFor(item.acquisition)].push(item)
    );
    (Object.keys(groups) as AcquisitionGroup[]).forEach((group) =>
      groups[group].sort((a, b) => {
        const positionA =
          a.acquisition.queuePosition ?? Number.MAX_SAFE_INTEGER;
        const positionB =
          b.acquisition.queuePosition ?? Number.MAX_SAFE_INTEGER;
        return positionA - positionB || a.title.localeCompare(b.title, locale);
      })
    );
    return groups;
  }, [acquisitionQueue, locale]);
  const { data: history, isLoading: historyLoading } = useSWR<{
    results: HistoryEvent[];
  }>(
    historyRequestId ? `/api/v1/hub/requests/${historyRequestId}/history` : null
  );

  const kindLabels: Record<RequestKind, string> = {
    movie: tr('Film', 'Movie'),
    tv: tr('Serie & Anime', 'Series & anime'),
    music_artist: tr('Künstler oder Gruppe', 'Artist or group'),
    music_album: 'Album',
    book: tr('Buch', 'Book'),
  };
  const stateLabels: Record<string, string> = {
    pending: tr('Wartet auf Freigabe', 'Awaiting approval'),
    approved: tr('Freigegeben', 'Approved'),
    processing: tr('Wird übermittelt', 'Submitting'),
    submitted: tr('Übermittelt', 'Submitted'),
    downloading: tr('Wird geladen', 'Downloading'),
    imported: tr('Importiert', 'Imported'),
    available: tr('Verfügbar', 'Available'),
    failed: tr('Fehlgeschlagen', 'Failed'),
    declined: tr('Abgelehnt', 'Declined'),
    cancelled: tr('Abgebrochen', 'Cancelled'),
  };
  const formatLabel = (request: UnifiedRequest) =>
    request.formats?.length
      ? request.formats
          .map((format) =>
            format === 'ebook' ? 'E-Book' : tr('Hörbuch', 'Audiobook')
          )
          .join(' & ')
      : undefined;
  const detailHref = (request: UnifiedRequest) =>
    request.source === 'seerr'
      ? `/${request.kind}/${request.externalId}`
      : `/hub/${request.kind}/${request.externalId}`;
  const KindIcon = ({ kind }: { kind: RequestKind }) => {
    if (kind === 'movie') return <FilmIcon className="h-6 w-6" />;
    if (kind === 'tv') return <TvIcon className="h-6 w-6" />;
    if (kind === 'book') return <BookOpenIcon className="h-6 w-6" />;
    return <MusicalNoteIcon className="h-6 w-6" />;
  };
  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
    setActivityPageState({ 1: { scanCursor: 0, skip: 0 } });
    setHistoryRequestId(undefined);
  };

  const hasNextPage =
    Boolean(data?.hasMore) &&
    data?.nextScanCursor !== undefined &&
    data.nextSkip !== undefined;

  const showNextPage = () => {
    if (!data || !hasNextPage) return;
    const targetPage = page + 1;
    setActivityPageState((current) => ({
      ...current,
      [targetPage]: {
        scanCursor: data.nextScanCursor as number,
        skip: data.nextSkip as number,
      },
    }));
    setPage(targetPage);
    setHistoryRequestId(undefined);
  };

  const requestAction = async (
    request: UnifiedRequest,
    action: 'approve' | 'retry' | 'decline'
  ) => {
    setActionError(undefined);
    try {
      const base =
        request.source === 'hub'
          ? `/api/v1/hub/requests/${request.sourceId}`
          : `/api/v1/request/${request.sourceId}`;
      await axios.post(`${base}/${action}`);
      await Promise.all([refreshActivity(), mutate('/api/v1/request/count')]);
    } catch (requestError) {
      setActionError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.message ?? requestError.message)
          : tr(
              'Die Anfrage konnte nicht aktualisiert werden.',
              'The request could not be updated.'
            )
      );
    }
  };

  const acquisitionIssueAction = async (
    issueId: number,
    action: 'retry' | 'acknowledge'
  ) => {
    setActionError(undefined);
    setAcquisitionActionMessage(undefined);
    setAcquisitionActionId(issueId);
    try {
      await axios.post(`/api/v1/hub/acquisition/issues/${issueId}/${action}`);
      await refreshActivity();
      setAcquisitionActionMessage(
        action === 'retry'
          ? tr(
              'Der erneute Downloadversuch wurde gestartet.',
              'The download retry was started.'
            )
          : tr('Das Problem wurde bestätigt.', 'The issue was acknowledged.')
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document.getElementById('acquisition-heading')?.focus()
        )
      );
    } catch (requestError) {
      setActionError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.message ?? requestError.message)
          : tr(
              'Der Downloadstatus konnte nicht aktualisiert werden.',
              'The download status could not be updated.'
            )
      );
    } finally {
      setAcquisitionActionId(undefined);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageTitle title={tr('Anfragen', 'Requests')} />
      <Header
        subtext={tr(
          'Filme, Serien, Anime, Musik, E-Books und Hörbücher gemeinsam verfolgen.',
          'Track movies, series, anime, music, e-books, and audiobooks together.'
        )}
      >
        {tr('Anfragen', 'Requests')}
      </Header>

      <div className="grid gap-3 rounded-xl border border-gray-700 bg-gray-800/60 p-4 md:grid-cols-3">
        <label className="text-sm text-gray-300">
          {tr('Suchen', 'Search')}
          <input
            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={query}
            onChange={(event) => updateFilter(setQuery, event.target.value)}
            placeholder={tr('Titel oder Künstler …', 'Title or artist…')}
          />
        </label>
        <label className="text-sm text-gray-300">
          {tr('Medientyp', 'Media type')}
          <select
            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={mediaFilter}
            onChange={(event) =>
              updateFilter(setMediaFilter, event.target.value)
            }
          >
            <option value="">
              {tr('Alle Medientypen', 'All media types')}
            </option>
            <option value="movie">{tr('Filme', 'Movies')}</option>
            <option value="tv">{tr('Serien & Anime', 'Series & anime')}</option>
            <option value="music_artist">
              {tr('Künstler & Gruppen', 'Artists & groups')}
            </option>
            <option value="music_album">{tr('Alben', 'Albums')}</option>
            <option value="ebook">E-Books</option>
            <option value="audiobook">{tr('Hörbücher', 'Audiobooks')}</option>
          </select>
        </label>
        <label className="text-sm text-gray-300">
          {tr('Status', 'Status')}
          <select
            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={stateFilter}
            onChange={(event) =>
              updateFilter(setStateFilter, event.target.value)
            }
          >
            <option value="">{tr('Alle Status', 'All statuses')}</option>
            {Object.entries(stateLabels).map(([state, label]) => (
              <option key={state} value={state}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data && acquisitionQueue && (
        <section
          aria-labelledby="acquisition-heading"
          className="rounded-xl border border-gray-700 bg-gray-800/60 p-4"
          data-testid="acquisition-queue"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ArrowDownTrayIcon
                  className="h-5 w-5 text-indigo-300"
                  aria-hidden="true"
                />
                <h2
                  id="acquisition-heading"
                  className="font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  tabIndex={-1}
                >
                  {tr('Downloads und Verarbeitung', 'Downloads and processing')}
                </h2>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {tr(
                  'Download, Nachbearbeitung und Bibliotheksimport werden getrennt angezeigt.',
                  'Download, post-processing, and library import are shown separately.'
                )}
              </p>
            </div>
            <div className="text-right text-xs text-gray-400">
              <span className="block">
                {acquisitionQueue.stale
                  ? tr('Letzter erfolgreicher Stand', 'Last successful update')
                  : tr('Stand', 'Updated')}{' '}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                }).format(
                  new Date(
                    acquisitionQueue.lastUpdatedAt ??
                      acquisitionQueue.observedAt
                  )
                )}
              </span>
              {acquisitionQueue.stale && (
                <span className="font-medium text-amber-200">
                  {tr(
                    'Live-Status derzeit nicht erreichbar',
                    'Live status currently unavailable'
                  )}
                </span>
              )}
            </div>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="sr-only"
            data-testid="acquisition-live-summary"
          >
            {tr('Downloadstatus:', 'Download status:')}{' '}
            {acquisitionGroups.downloading.length} {tr('aktiv', 'active')},{' '}
            {acquisitionGroups.queued.length} {tr('wartend', 'waiting')},{' '}
            {acquisitionGroups.processing.length}{' '}
            {tr('in Nachbearbeitung', 'post-processing')},{' '}
            {acquisitionGroups.paused.length} {tr('pausiert', 'paused')},{' '}
            {acquisitionGroups.problems.length} {tr('Probleme', 'problems')}.
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ['downloading', tr('Aktiv', 'Active'), ArrowDownTrayIcon],
                ['queued', tr('Wartet', 'Waiting'), ClockIcon],
                [
                  'processing',
                  tr('Nachbearbeitung', 'Post-processing'),
                  ArrowPathIcon,
                ],
                ['paused', tr('Pausiert', 'Paused'), PauseCircleIcon],
                [
                  'problems',
                  tr('Probleme', 'Problems'),
                  ExclamationTriangleIcon,
                ],
              ] as const
            ).map(([group, label, Icon]) => (
              <div
                key={group}
                data-testid={`acquisition-summary-${group}`}
                className={`rounded-lg border p-3 ${
                  group === 'problems' && acquisitionGroups[group].length
                    ? 'border-red-800 bg-red-950/30'
                    : 'border-gray-700 bg-gray-900/50'
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{label}</span>
                </div>
                <span className="mt-1 block text-xl font-semibold text-white">
                  {acquisitionGroups[group].length}
                </span>
              </div>
            ))}
          </div>

          {acquisitionQueue.summary.totalBytes > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
                <span>
                  {tr(
                    'Übertragungsfortschritt der aktuellen Warteschlange',
                    'Transfer progress of the current queue'
                  )}
                </span>
                <span>{acquisitionQueue.summary.progress}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={tr(
                  'Übertragungsfortschritt der aktuellen Warteschlange',
                  'Transfer progress of the current queue'
                )}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={acquisitionQueue.summary.progress}
                aria-valuetext={`${acquisitionQueue.summary.progress}%`}
                className="h-3 overflow-hidden rounded-full border border-gray-500 bg-gray-800"
              >
                <div
                  className="h-full rounded-full bg-indigo-400 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${acquisitionQueue.summary.progress}%` }}
                />
              </div>
            </div>
          )}

          {acquisitionQueue.summary.total ? (
            <div className="mt-5 space-y-6">
              {(
                [
                  ['downloading', tr('Aktiv', 'Active'), ArrowDownTrayIcon],
                  ['queued', tr('Wartet', 'Waiting'), ClockIcon],
                  [
                    'processing',
                    tr(
                      'Nachbearbeitung und Import',
                      'Post-processing and import'
                    ),
                    ArrowPathIcon,
                  ],
                  ['paused', tr('Pausiert', 'Paused'), PauseCircleIcon],
                  [
                    'problems',
                    tr('Eingriff nötig', 'Needs attention'),
                    ExclamationTriangleIcon,
                  ],
                ] as const
              ).map(([group, label, Icon]) =>
                acquisitionGroups[group].length ? (
                  <section key={group} aria-labelledby={`acquisition-${group}`}>
                    <h3
                      id={`acquisition-${group}`}
                      className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-100"
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {label}
                      <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs font-normal text-gray-200">
                        <span className="sr-only">
                          {tr('Anzahl:', 'Count:')}{' '}
                        </span>
                        {acquisitionGroups[group].length}
                      </span>
                    </h3>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {acquisitionGroups[group].map((item) => {
                        const issue = item.acquisition.issue;
                        return (
                          <article
                            key={item.id}
                            className="flex gap-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3"
                            data-testid={`acquisition-item-${group}`}
                          >
                            <div
                              className="flex h-16 w-11 flex-none items-center justify-center rounded bg-gray-950 bg-cover bg-center text-indigo-300"
                              style={
                                item.imageUrl
                                  ? { backgroundImage: `url(${item.imageUrl})` }
                                  : undefined
                              }
                              aria-hidden="true"
                            >
                              {!item.imageUrl && <KindIcon kind={item.kind} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  href={
                                    item.kind === 'movie' || item.kind === 'tv'
                                      ? `/${item.kind}/${item.externalId}`
                                      : `/hub/${item.kind}/${item.externalId}`
                                  }
                                  className="truncate font-medium text-white hover:text-indigo-300 hover:underline"
                                >
                                  {item.title}
                                </Link>
                                {item.is4k && (
                                  <span className="rounded bg-amber-700 px-1.5 py-0.5 text-xs text-white">
                                    4K
                                  </span>
                                )}
                              </div>
                              <AcquisitionStatus
                                acquisition={item.acquisition}
                                title={item.title}
                                isVideo={
                                  item.kind === 'movie' || item.kind === 'tv'
                                }
                                detailed
                              />
                              {issue && canRetryAcquisition && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {issue.retryable && (
                                    <button
                                      type="button"
                                      disabled={
                                        acquisitionActionId === issue.id
                                      }
                                      className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-50"
                                      onClick={() =>
                                        acquisitionIssueAction(
                                          issue.id,
                                          'retry'
                                        )
                                      }
                                    >
                                      {tr(
                                        'Download erneut versuchen',
                                        'Retry download'
                                      )}
                                    </button>
                                  )}
                                  {!issue.acknowledged && (
                                    <button
                                      type="button"
                                      disabled={
                                        acquisitionActionId === issue.id
                                      }
                                      className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600 disabled:cursor-wait disabled:opacity-50"
                                      onClick={() =>
                                        acquisitionIssueAction(
                                          issue.id,
                                          'acknowledge'
                                        )
                                      }
                                    >
                                      {tr(
                                        'Problem bestätigen',
                                        'Acknowledge issue'
                                      )}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">
              {tr(
                'Zurzeit wartet kein Medium auf Download oder Verarbeitung.',
                'No media is currently waiting for download or processing.'
              )}
            </p>
          )}

          {acquisitionQueue.recentIssues.length > 0 && (
            <section
              aria-labelledby="recent-acquisition-issues-heading"
              className="mt-6 border-t border-gray-700 pt-4"
            >
              <h3
                id="recent-acquisition-issues-heading"
                className="flex items-center gap-2 text-sm font-semibold text-gray-100"
              >
                <CheckCircleIcon
                  className="h-5 w-5 text-emerald-300"
                  aria-hidden="true"
                />
                {tr('Kürzlich gelöst', 'Recently resolved')}
              </h3>
              <ul className="mt-2 space-y-2">
                {acquisitionQueue.recentIssues.map((issue) => (
                  <li
                    key={`${issue.source}:${issue.requestId}:${issue.reasonCode}:${issue.resolvedAt}`}
                    data-testid="recent-acquisition-issue"
                    className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3"
                  >
                    <p className="font-medium text-gray-100">{issue.title}</p>
                    <p className="mt-1 text-sm text-gray-300">
                      {formatAcquisitionIssueMessage(issue, locale)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {tr('Gelöst am', 'Resolved on')}{' '}
                      <time dateTime={issue.resolvedAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(issue.resolvedAt))}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-900/50 p-3 text-red-200">
          {actionError}
        </p>
      )}

      {acquisitionActionMessage && (
        <p role="status" aria-live="polite" className="sr-only">
          {acquisitionActionMessage}
        </p>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : error || !data ? (
        <p
          role="alert"
          className="rounded-xl border border-red-800 p-5 text-red-300"
        >
          {tr(
            'Die Anfragen konnten nicht geladen werden.',
            'Requests could not be loaded.'
          )}
        </p>
      ) : data.results.length ? (
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/60">
          {data.results.map((request) => {
            const historyOpen =
              request.source === 'hub' && historyRequestId === request.sourceId;
            const canManage = request.source === 'hub' ? admin : canManageVideo;
            return (
              <article
                key={request.id}
                className="border-b border-gray-700 p-4 last:border-b-0"
              >
                <div className="flex gap-4">
                  <div
                    className="flex h-20 w-14 flex-none items-center justify-center rounded bg-gray-900 bg-cover bg-center text-indigo-300"
                    style={
                      request.imageUrl
                        ? { backgroundImage: `url(${request.imageUrl})` }
                        : undefined
                    }
                    aria-hidden="true"
                  >
                    {!request.imageUrl && <KindIcon kind={request.kind} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <Link
                          href={detailHref(request)}
                          className="font-semibold text-white hover:text-indigo-300 hover:underline"
                        >
                          {request.title}
                        </Link>
                        {request.subtitle && (
                          <p className="truncate text-sm text-gray-400">
                            {request.subtitle}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-gray-400">
                          {kindLabels[request.kind]}
                          {formatLabel(request)
                            ? ` · ${formatLabel(request)}`
                            : ''}
                          {' · '}
                          {tr('Anfrage:', 'Request:')}{' '}
                          {stateLabels[request.state] ?? request.state}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {tr('Angefragt von', 'Requested by')}{' '}
                          {request.requestedBy.displayName} ·{' '}
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(request.createdAt))}
                        </p>
                        {request.errorMessage && (
                          <p className="mt-2 text-sm text-red-300">
                            {request.errorMessage}
                          </p>
                        )}
                        {request.acquisition && (
                          <div className="mt-3 border-t border-gray-700 pt-3">
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                              {tr(
                                'Download und Verfügbarkeit',
                                'Download and availability'
                              )}
                            </p>
                            <AcquisitionStatus
                              acquisition={request.acquisition}
                              title={request.title}
                              isVideo={
                                request.kind === 'movie' ||
                                request.kind === 'tv'
                              }
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {request.source === 'hub' && (
                          <button
                            type="button"
                            className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                            aria-expanded={historyOpen}
                            onClick={() =>
                              setHistoryRequestId(
                                historyOpen ? undefined : request.sourceId
                              )
                            }
                          >
                            {historyOpen
                              ? tr('Verlauf schließen', 'Close history')
                              : tr('Verlauf', 'History')}
                          </button>
                        )}
                        {canManage && request.state === 'pending' && (
                          <>
                            <button
                              type="button"
                              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500"
                              onClick={() => requestAction(request, 'approve')}
                            >
                              {tr('Freigeben', 'Approve')}
                            </button>
                            <button
                              type="button"
                              className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                              onClick={() => requestAction(request, 'decline')}
                            >
                              {tr('Ablehnen', 'Decline')}
                            </button>
                          </>
                        )}
                        {canManage && request.state === 'failed' && (
                          <button
                            type="button"
                            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500"
                            onClick={() => requestAction(request, 'retry')}
                          >
                            {tr('Erneut versuchen', 'Retry')}
                          </button>
                        )}
                      </div>
                    </div>
                    {historyOpen && (
                      <div className="mt-3 rounded-lg bg-gray-900/70 p-3 text-sm text-gray-300">
                        {historyLoading ? (
                          <p>
                            {tr('Verlauf wird geladen …', 'Loading history…')}
                          </p>
                        ) : history?.results.length ? (
                          <ol className="space-y-2">
                            {history.results.map((event) => (
                              <li key={event.id}>
                                <time className="text-gray-500">
                                  {new Intl.DateTimeFormat(locale, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }).format(new Date(event.createdAt))}
                                </time>{' '}
                                ·{' '}
                                {event.action === 'state_changed'
                                  ? `${stateLabels[event.from ?? ''] ?? event.from} → ${stateLabels[event.to ?? ''] ?? event.to}`
                                  : event.action.replaceAll('_', ' ')}
                                {event.actor
                                  ? ` · ${event.actor.displayName}`
                                  : ''}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>{tr('Noch kein Verlauf.', 'No history yet.')}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
          <p className="text-lg font-semibold text-gray-200">
            {data?.hasMore
              ? tr(
                  'Auf dieser Scan-Seite noch keine Treffer',
                  'No matches on this scan page yet'
                )
              : tr('Keine passenden Anfragen', 'No matching requests')}
          </p>
          <p className="mt-1">
            {data?.hasMore
              ? tr(
                  'Mit Weiter werden ältere Anfragen durchsucht.',
                  'Continue to search older requests.'
                )
              : tr(
                  'Ändere die Filter oder wünsche ein neues Medium.',
                  'Change the filters or request new media.'
                )}
          </p>
        </div>
      )}

      {data && (page > 1 || data.hasMore) && (
        <nav
          aria-label={tr('Seitennavigation', 'Pagination')}
          className="flex items-center justify-between"
        >
          <button
            type="button"
            disabled={page === 1}
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
              setHistoryRequestId(undefined);
            }}
            className="flex items-center gap-2 rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 disabled:opacity-40"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            {tr('Zurück', 'Previous')}
          </button>
          <span className="text-sm text-gray-400">
            {tr('Seite', 'Page')} {page}
          </span>
          <button
            type="button"
            disabled={!hasNextPage}
            onClick={showNextPage}
            className="flex items-center gap-2 rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 disabled:opacity-40"
          >
            {tr('Weiter', 'Next')}
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
};

export default UnifiedRequestList;
