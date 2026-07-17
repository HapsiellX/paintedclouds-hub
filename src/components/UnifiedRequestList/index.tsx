import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useLocale from '@app/hooks/useLocale';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  MusicalNoteIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';

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
}

interface ActivityResponse {
  results: UnifiedRequest[];
  take: number;
  skip: number;
  total: number;
  hasMore: boolean;
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
  const [page, setPage] = useState(1);
  const [mediaFilter, setMediaFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [query, setQuery] = useState('');
  const [historyRequestId, setHistoryRequestId] = useState<number>();
  const [actionError, setActionError] = useState<string>();

  const { kinds, formats } = useMemo(() => {
    if (mediaFilter === 'ebook' || mediaFilter === 'audiobook') {
      return { kinds: 'book', formats: mediaFilter };
    }
    return { kinds: mediaFilter, formats: '' };
  }, [mediaFilter]);

  const activityUrl = `/api/v1/hub/activity?take=${PAGE_SIZE}&skip=${
    (page - 1) * PAGE_SIZE
  }&kinds=${encodeURIComponent(kinds)}&formats=${encodeURIComponent(
    formats
  )}&states=${encodeURIComponent(stateFilter)}&query=${encodeURIComponent(
    query
  )}`;
  const {
    data,
    error,
    isLoading,
    mutate: refreshActivity,
  } = useSWR<ActivityResponse>(activityUrl, { refreshInterval: 30_000 });
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

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-900/50 p-3 text-red-200">
          {actionError}
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
            {tr('Keine passenden Anfragen', 'No matching requests')}
          </p>
          <p className="mt-1">
            {tr(
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
            disabled={!data.hasMore}
            onClick={() => {
              setPage((current) => current + 1);
              setHistoryRequestId(undefined);
            }}
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
