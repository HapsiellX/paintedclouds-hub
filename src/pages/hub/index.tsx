import useLocale from '@app/hooks/useLocale';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  BookOpenIcon,
  CircleStackIcon,
  FilmIcon,
  MusicalNoteIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';

type HubKind = 'movie' | 'tv' | 'music_artist' | 'music_album' | 'book';

interface CatalogItem {
  kind: HubKind;
  provider: string;
  externalId: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  year?: number;
}

interface HubRequest {
  id: number | string;
  source?: 'hub' | 'seerr';
  sourceId?: number;
  kind: HubKind;
  title: string;
  subtitle?: string;
  state: string;
  errorMessage?: string;
  requestedBy?: { displayName: string };
}

interface HubHistoryEvent {
  id: number;
  action: string;
  createdAt: string;
  from?: string;
  to?: string;
  actor?: { displayName: string };
}

interface Overview {
  services: {
    id: string;
    name: string;
    healthy: boolean;
    version?: string;
    queueSize?: number;
    error?: string;
  }[];
  storage: { usedPercent?: number; freeBytes?: number };
  requests: HubRequest[];
}

interface ProviderStatus {
  providers: {
    provider: string;
    healthy: boolean;
    lastSuccess: string | null;
    circuitOpenUntil: string | null;
    errorHistory: { at: string; code: string }[];
  }[];
}

const kindLabelsDe: Record<HubKind, string> = {
  movie: 'Film',
  tv: 'Serie',
  music_artist: 'Künstler',
  music_album: 'Album',
  book: 'Buch',
};

const kindLabelsEn: Record<HubKind, string> = {
  movie: 'Movie',
  tv: 'Series',
  music_artist: 'Artist',
  music_album: 'Album',
  book: 'Book',
};

const stateLabelsDe: Record<string, string> = {
  pending: 'Freigabe nötig',
  approved: 'Freigegeben',
  processing: 'Wird verarbeitet',
  submitted: 'Übermittelt',
  downloading: 'Wird geladen',
  imported: 'Importiert',
  available: 'Verfügbar',
  failed: 'Fehlgeschlagen',
  declined: 'Abgelehnt',
  cancelled: 'Abgebrochen',
};

const stateLabelsEn: Record<string, string> = {
  pending: 'Approval required',
  approved: 'Approved',
  processing: 'Processing',
  submitted: 'Submitted',
  downloading: 'Downloading',
  imported: 'Imported',
  available: 'Available',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

const allKinds: HubKind[] = [
  'movie',
  'tv',
  'music_artist',
  'music_album',
  'book',
];

const parseKinds = (value: string | string[] | undefined): HubKind[] => {
  const requested = (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .filter((kind): kind is HubKind => allKinds.includes(kind as HubKind));
  return requested.length ? requested : allKinds;
};

const HubPage: NextPage = () => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const kindLabels = locale === 'de' ? kindLabelsDe : kindLabelsEn;
  const stateLabels = locale === 'de' ? stateLabelsDe : stateLabelsEn;
  const router = useRouter();
  const { hasPermission } = useUser();
  const admin = hasPermission(Permission.ADMIN);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [kinds, setKinds] = useState<HubKind[]>(allKinds);
  const [message, setMessage] = useState<string>();
  const [activityKind, setActivityKind] = useState('');
  const [activityState, setActivityState] = useState('');
  const [activityQuery, setActivityQuery] = useState('');
  const [historyRequestId, setHistoryRequestId] = useState<number>();
  const searchUrl = useMemo(
    () =>
      submittedQuery
        ? `/api/v1/hub/search?query=${encodeURIComponent(submittedQuery)}&kinds=${encodeURIComponent(kinds.join(','))}`
        : null,
    [submittedQuery, kinds]
  );
  const {
    data: search,
    error: searchError,
    isLoading: searching,
  } = useSWR<{
    results: CatalogItem[];
    errors: string[];
  }>(searchUrl);
  const { data: overview, mutate: refreshOverview } = useSWR<Overview>(
    '/api/v1/hub/overview',
    { refreshInterval: 30_000 }
  );
  const { data: quota, mutate: refreshQuota } = useSWR<{
    enabled: boolean;
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
    windowDays: number;
  }>('/api/v1/hub/quota');
  const { data: activity, mutate: refreshActivity } = useSWR<{
    results: HubRequest[];
  }>(
    `/api/v1/hub/activity?take=30&kinds=${encodeURIComponent(activityKind)}&states=${encodeURIComponent(activityState)}&query=${encodeURIComponent(activityQuery)}`,
    { refreshInterval: 30_000 }
  );
  const { data: reconciliation, mutate: refreshReconciliation } = useSWR<{
    running: boolean;
    lastCompletedAt?: string;
    checked: number;
    changed: number;
    failed: number;
  }>(admin ? '/api/v1/hub/reconciliation' : null, {
    refreshInterval: 15_000,
  });
  const { data: history, isLoading: historyLoading } = useSWR<{
    results: HubHistoryEvent[];
  }>(
    historyRequestId ? `/api/v1/hub/requests/${historyRequestId}/history` : null
  );
  const { data: providerStatus } = useSWR<ProviderStatus>(
    admin ? '/api/v1/hub/providers/status' : null,
    { refreshInterval: 30_000 }
  );

  useEffect(() => {
    if (!router.isReady) return;
    const routeQuery = Array.isArray(router.query.query)
      ? router.query.query[0]
      : (router.query.query ?? '');
    const routeKinds = parseKinds(router.query.kinds);
    setQuery(routeQuery);
    setSubmittedQuery(routeQuery.trim().length >= 2 ? routeQuery.trim() : '');
    setKinds(routeKinds);
  }, [router.isReady, router.query.kinds, router.query.query]);

  const toggleKind = (kind: HubKind) =>
    setKinds((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind]
    );

  const requestItem = async (
    item: CatalogItem,
    formats?: ('ebook' | 'audiobook')[]
  ) => {
    if (item.kind === 'movie' || item.kind === 'tv') {
      await router.push(`/${item.kind}/${item.externalId}`);
      return;
    }
    setMessage(undefined);
    try {
      const response = await axios.post<HubRequest>('/api/v1/hub/requests', {
        ...item,
        formats,
        languages: ['de', 'en'],
      });
      await mutate('/api/v1/request/count');
      setMessage(
        response.data.state === 'failed'
          ? response.data.errorMessage
          : tr(
              `${item.title} wurde als Wunsch aufgenommen.`,
              `${item.title} was added as a request.`
            )
      );
      await refreshOverview();
      await refreshActivity();
      await refreshQuota();
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? (error.response?.data?.message ?? error.message)
          : tr(
              'Der Wunsch konnte nicht gespeichert werden.',
              'The request could not be saved.'
            )
      );
    }
  };

  const requestAction = async (
    request: HubRequest,
    action: 'approve' | 'retry'
  ) => {
    await axios.post(
      `/api/v1/hub/requests/${request.sourceId ?? request.id}/${action}`
    );
    await refreshOverview();
    await refreshActivity();
  };

  const runReconciliation = async () => {
    setMessage(undefined);
    try {
      await axios.post('/api/v1/hub/reconciliation');
      await Promise.all([refreshReconciliation(), refreshActivity()]);
      setMessage(
        tr('Statusabgleich abgeschlossen.', 'Status reconciliation completed.')
      );
    } catch {
      setMessage(
        tr('Statusabgleich fehlgeschlagen.', 'Status reconciliation failed.')
      );
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <header
        className="rounded-2xl border border-indigo-500/20 bg-cover bg-center p-6 shadow-xl"
        style={{
          backgroundImage:
            'linear-gradient(100deg, rgba(8, 10, 28, 0.98) 0%, rgba(16, 18, 45, 0.92) 48%, rgba(12, 10, 35, 0.58) 100%), url(/images/paintedclouds-hub-hero-v0.3.webp)',
        }}
      >
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-300">
          StefARR by PaintedClouds
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white md:text-4xl">
          {tr(
            'Eine Suche für deine gesamte Medienwelt',
            'One search for your entire media world'
          )}
        </h1>
        <p className="mt-3 max-w-3xl text-gray-300">
          {tr(
            'Filme, Serien, Anime, Musik, E-Books und Hörbücher suchen, wünschen und bis zum Import verfolgen.',
            'Search and request movies, series, anime, music, e-books, and audiobooks, then track them through import.'
          )}
        </p>
        <form
          className="mt-6 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedQuery = query.trim();
            if (normalizedQuery.length >= 2 && kinds.length) {
              setSubmittedQuery(normalizedQuery);
              void router.replace(
                {
                  pathname: '/',
                  query: { query: normalizedQuery, kinds: kinds.join(',') },
                },
                undefined,
                { shallow: true }
              );
            }
          }}
        >
          <input
            data-testid="hub-search-input"
            className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-950/80 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr(
              'Titel, Autor, Künstler oder Album …',
              'Title, author, artist, or album…'
            )}
            aria-label={tr('Medien durchsuchen', 'Search media')}
          />
          <button
            data-testid="hub-search-submit"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={query.trim().length < 2 || !kinds.length}
          >
            {tr('Suchen', 'Search')}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(kindLabels) as HubKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                kinds.includes(kind)
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
                  : 'border-gray-700 text-gray-500'
              }`}
            >
              {kindLabels[kind]}
            </button>
          ))}
        </div>
        {quota?.enabled && (
          <p className="mt-4 text-sm text-indigo-200">
            {tr(
              `${quota.remaining} von ${quota.limit} Punkten in ${quota.windowDays} Tagen verfügbar`,
              `${quota.remaining} of ${quota.limit} points available over ${quota.windowDays} days`
            )}
          </p>
        )}
      </header>

      {message && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/50 px-4 py-3 text-indigo-100">
          {message}
        </div>
      )}

      {(searching || search || searchError) && (
        <section data-testid="hub-search-results">
          <h2 className="mb-4 text-2xl font-semibold text-white">
            {tr('Suchergebnisse', 'Search results')}
          </h2>
          {searching ? (
            <p className="text-gray-400">
              {tr('Kataloge werden durchsucht …', 'Searching catalogs…')}
            </p>
          ) : searchError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-4 text-red-200">
              {tr(
                'Die Suche konnte nicht ausgeführt werden. Bitte versuche es erneut.',
                'The search failed. Please try again.'
              )}
            </div>
          ) : search?.results.length === 0 ? (
            <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 text-gray-300">
              {tr(
                'Keine passenden Ergebnisse gefunden. Prüfe die ausgewählten Medientypen oder versuche einen anderen Suchbegriff.',
                'No matching results were found. Check the selected media types or try another search term.'
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {search?.results.map((item) => (
                <article
                  data-testid={`hub-result-${item.kind}`}
                  key={`${item.provider}-${item.kind}-${item.externalId}`}
                  className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/70"
                >
                  <div
                    className="h-48 bg-gradient-to-br from-gray-700 to-gray-900 bg-cover bg-center"
                    style={
                      item.imageUrl
                        ? { backgroundImage: `url(${item.imageUrl})` }
                        : undefined
                    }
                  />
                  <div className="space-y-3 p-4">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                        {kindLabels[item.kind]}
                      </span>
                      <h3 className="line-clamp-2 text-lg font-semibold text-white">
                        {item.title}
                      </h3>
                      <p className="line-clamp-1 text-sm text-gray-400">
                        {[item.subtitle, item.year]
                          .filter(Boolean)
                          .join(' · ') || 'Keine Zusatzangaben'}
                      </p>
                    </div>
                    {item.kind === 'movie' || item.kind === 'tv' ? (
                      <button
                        className="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500"
                        onClick={() => requestItem(item)}
                      >
                        {tr('Details & Wunsch', 'Details & request')}
                      </button>
                    ) : (
                      <button
                        className="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500"
                        onClick={() =>
                          router.push(`/hub/${item.kind}/${item.externalId}`)
                        }
                      >
                        {tr('Details & Wunsch', 'Details & request')}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {!!search?.errors.length && (
            <p className="mt-3 text-sm text-amber-300">
              {tr(
                'Einzelne Kataloge waren vorübergehend nicht erreichbar; vorhandene Treffer werden trotzdem angezeigt.',
                'Some catalogs were temporarily unavailable; available results are still shown.'
              )}
            </p>
          )}
        </section>
      )}

      <section id="activity" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ServerStackIcon className="h-6 w-6 text-indigo-300" />
            <h2 className="text-2xl font-semibold text-white">
              {tr('Systemzustand', 'System status')}
            </h2>
          </div>
          {admin && (
            <button
              type="button"
              disabled={reconciliation?.running}
              onClick={runReconciliation}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600 disabled:opacity-50"
            >
              {reconciliation?.running
                ? tr('Abgleich läuft …', 'Reconciling…')
                : tr('Jetzt abgleichen', 'Reconcile now')}
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {overview?.services.map((service) => (
            <div
              key={service.id}
              className="rounded-xl border border-gray-700 bg-gray-800/60 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{service.name}</span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${service.healthy ? 'bg-emerald-400' : 'bg-red-400'}`}
                />
              </div>
              <p className="mt-2 text-sm text-gray-400">
                {service.healthy
                  ? `Version ${service.version ?? 'unbekannt'} · Queue ${service.queueSize ?? 0}`
                  : service.error}
              </p>
            </div>
          ))}
          <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
            <div className="flex items-center gap-2 font-semibold text-white">
              <CircleStackIcon className="h-5 w-5 text-indigo-300" />{' '}
              {tr('Speicher', 'Storage')}
            </div>
            <p className="mt-2 text-sm text-gray-400">
              {overview?.storage.usedPercent === undefined
                ? tr('Noch keine Speicherdaten', 'No storage data yet')
                : tr(
                    `${overview.storage.usedPercent} % belegt`,
                    `${overview.storage.usedPercent}% used`
                  )}
            </p>
          </div>
          {providerStatus?.providers.map((provider) => (
            <div
              key={provider.provider}
              className="rounded-xl border border-gray-700 bg-gray-800/60 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize text-white">
                  {provider.provider}
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${provider.healthy ? 'bg-emerald-400' : 'bg-red-400'}`}
                />
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Letzter Erfolg:{' '}
                {provider.lastSuccess
                  ? new Date(provider.lastSuccess).toLocaleString('de-DE')
                  : 'noch keiner'}
                {' · '}Fehlerhistorie: {provider.errorHistory.length}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-2xl font-semibold text-white">
            {tr('Alle Wünsche', 'All requests')}
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              value={activityQuery}
              onChange={(event) => setActivityQuery(event.target.value)}
              placeholder={tr('Wünsche filtern …', 'Filter requests…')}
            />
            <select
              className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              value={activityKind}
              onChange={(event) => setActivityKind(event.target.value)}
            >
              <option value="">
                {tr('Alle Medientypen', 'All media types')}
              </option>
              {allKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabels[kind]}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              value={activityState}
              onChange={(event) => setActivityState(event.target.value)}
            >
              <option value="">{tr('Alle Status', 'All statuses')}</option>
              {Object.entries(stateLabels).map(([state, label]) => (
                <option key={state} value={state}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/60">
          {activity?.results.length ? (
            activity.results.map((request) => {
              const sourceId = request.sourceId ?? Number(request.id);
              const historyOpen =
                request.source !== 'seerr' && historyRequestId === sourceId;
              return (
                <div
                  key={request.id}
                  className="border-b border-gray-700 px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-white">{request.title}</p>
                      <p className="text-sm text-gray-400">
                        {kindLabels[request.kind]} ·{' '}
                        {stateLabels[request.state] ?? request.state}
                        {request.errorMessage
                          ? ` · ${request.errorMessage}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {request.source !== 'seerr' && (
                        <button
                          type="button"
                          className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                          aria-expanded={historyOpen}
                          onClick={() =>
                            setHistoryRequestId(
                              historyOpen ? undefined : sourceId
                            )
                          }
                        >
                          {historyOpen
                            ? tr('Verlauf schließen', 'Close history')
                            : tr('Verlauf', 'History')}
                        </button>
                      )}
                      {admin &&
                        request.source !== 'seerr' &&
                        ['pending', 'failed'].includes(request.state) && (
                          <button
                            className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                            onClick={() =>
                              requestAction(
                                request,
                                request.state === 'pending'
                                  ? 'approve'
                                  : 'retry'
                              )
                            }
                          >
                            {request.state === 'pending'
                              ? tr('Freigeben', 'Approve')
                              : tr('Erneut versuchen', 'Retry')}
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
              );
            })
          ) : (
            <p className="p-4 text-gray-400">
              {tr('Noch keine Wünsche.', 'No requests yet.')}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <FilmIcon className="h-6 w-6 text-indigo-300" />{' '}
          {tr('Film, Serie & Anime', 'Movies, series & anime')}
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <MusicalNoteIcon className="h-6 w-6 text-indigo-300" />{' '}
          {tr('Album & Künstler', 'Albums & artists')}
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <BookOpenIcon className="h-6 w-6 text-indigo-300" />{' '}
          {tr('E-Book & Hörbuch', 'E-books & audiobooks')}
        </div>
      </div>
    </div>
  );
};

export default HubPage;
