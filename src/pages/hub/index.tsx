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
import useSWR from 'swr';

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
  id: number;
  kind: HubKind;
  title: string;
  subtitle?: string;
  state: string;
  errorMessage?: string;
  requestedBy?: { displayName: string };
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

const kindLabels: Record<HubKind, string> = {
  movie: 'Film',
  tv: 'Serie',
  music_artist: 'Künstler',
  music_album: 'Album',
  book: 'Buch',
};

const stateLabels: Record<string, string> = {
  pending: 'Freigabe nötig',
  approved: 'Freigegeben',
  submitted: 'Übermittelt',
  downloading: 'Wird geladen',
  imported: 'Importiert',
  available: 'Verfügbar',
  failed: 'Fehlgeschlagen',
  declined: 'Abgelehnt',
  cancelled: 'Abgebrochen',
};

const allKinds = Object.keys(kindLabels) as HubKind[];

const parseKinds = (value: string | string[] | undefined): HubKind[] => {
  const requested = (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .filter((kind): kind is HubKind => allKinds.includes(kind as HubKind));
  return requested.length ? requested : allKinds;
};

const HubPage: NextPage = () => {
  const router = useRouter();
  const { hasPermission } = useUser();
  const admin = hasPermission(Permission.ADMIN);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [kinds, setKinds] = useState<HubKind[]>(allKinds);
  const [message, setMessage] = useState<string>();
  const searchUrl = useMemo(
    () =>
      submittedQuery
        ? `/api/v1/hub/search?query=${encodeURIComponent(submittedQuery)}&kinds=${kinds.join(',')}`
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
      setMessage(
        response.data.state === 'failed'
          ? response.data.errorMessage
          : `${item.title} wurde als Wunsch aufgenommen.`
      );
      await refreshOverview();
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? (error.response?.data?.message ?? error.message)
          : 'Der Wunsch konnte nicht gespeichert werden.'
      );
    }
  };

  const requestAction = async (
    request: HubRequest,
    action: 'approve' | 'retry'
  ) => {
    await axios.post(`/api/v1/hub/requests/${request.id}/${action}`);
    await refreshOverview();
  };

  return (
    <div className="space-y-8 pb-10">
      <header className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/80 to-gray-900 p-6 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-300">
          PaintedClouds Hub
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white md:text-4xl">
          Eine Suche für deine gesamte Medienwelt
        </h1>
        <p className="mt-3 max-w-3xl text-gray-300">
          Filme, Serien, Anime, Musik, E-Books und Hörbücher suchen, wünschen
          und bis zum Import verfolgen.
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
                  pathname: '/hub',
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
            placeholder="Titel, Autor, Künstler oder Album …"
            aria-label="Medien durchsuchen"
          />
          <button
            data-testid="hub-search-submit"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={query.trim().length < 2 || !kinds.length}
          >
            Suchen
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
      </header>

      {message && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/50 px-4 py-3 text-indigo-100">
          {message}
        </div>
      )}

      {(searching || search || searchError) && (
        <section data-testid="hub-search-results">
          <h2 className="mb-4 text-2xl font-semibold text-white">
            Suchergebnisse
          </h2>
          {searching ? (
            <p className="text-gray-400">Kataloge werden durchsucht …</p>
          ) : searchError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-4 text-red-200">
              Die Suche konnte nicht ausgeführt werden. Bitte versuche es noch
              einmal.
            </div>
          ) : search?.results.length === 0 ? (
            <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 text-gray-300">
              Keine passenden Ergebnisse gefunden. Prüfe die ausgewählten
              Medientypen oder versuche einen anderen Suchbegriff.
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
                    {item.kind === 'book' ? (
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <button
                          className="rounded bg-indigo-600 px-2 py-2 text-white hover:bg-indigo-500"
                          onClick={() => requestItem(item, ['ebook'])}
                        >
                          E-Book
                        </button>
                        <button
                          className="rounded bg-indigo-600 px-2 py-2 text-white hover:bg-indigo-500"
                          onClick={() => requestItem(item, ['audiobook'])}
                        >
                          Hörbuch
                        </button>
                        <button
                          className="rounded bg-indigo-600 px-2 py-2 text-white hover:bg-indigo-500"
                          onClick={() =>
                            requestItem(item, ['ebook', 'audiobook'])
                          }
                        >
                          Beides
                        </button>
                      </div>
                    ) : (
                      <button
                        className="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500"
                        onClick={() => requestItem(item)}
                      >
                        {item.kind === 'movie' || item.kind === 'tv'
                          ? 'Details & Wunsch'
                          : 'Wünschen'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {!!search?.errors.length && (
            <p className="mt-3 text-sm text-amber-300">
              Einzelne Kataloge waren vorübergehend nicht erreichbar; vorhandene
              Treffer werden trotzdem angezeigt.
            </p>
          )}
        </section>
      )}

      <section>
        <div className="mb-4 flex items-center gap-2">
          <ServerStackIcon className="h-6 w-6 text-indigo-300" />
          <h2 className="text-2xl font-semibold text-white">Systemzustand</h2>
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
              <CircleStackIcon className="h-5 w-5 text-indigo-300" /> Speicher
            </div>
            <p className="mt-2 text-sm text-gray-400">
              {overview?.storage.usedPercent === undefined
                ? 'Noch keine Speicherdaten'
                : `${overview.storage.usedPercent} % belegt`}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold text-white">
          Letzte Wünsche
        </h2>
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/60">
          {overview?.requests.length ? (
            overview.requests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-3 border-b border-gray-700 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-white">{request.title}</p>
                  <p className="text-sm text-gray-400">
                    {kindLabels[request.kind]} ·{' '}
                    {stateLabels[request.state] ?? request.state}
                    {request.errorMessage ? ` · ${request.errorMessage}` : ''}
                  </p>
                </div>
                {admin && ['pending', 'failed'].includes(request.state) && (
                  <button
                    className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                    onClick={() =>
                      requestAction(
                        request,
                        request.state === 'pending' ? 'approve' : 'retry'
                      )
                    }
                  >
                    {request.state === 'pending'
                      ? 'Freigeben'
                      : 'Erneut versuchen'}
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="p-4 text-gray-400">Noch keine erweiterten Wünsche.</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <FilmIcon className="h-6 w-6 text-indigo-300" /> Film, Serie & Anime
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <MusicalNoteIcon className="h-6 w-6 text-indigo-300" /> Album &
          Künstler
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 p-4 text-gray-300">
          <BookOpenIcon className="h-6 w-6 text-indigo-300" /> E-Book & Hörbuch
        </div>
      </div>
    </div>
  );
};

export default HubPage;
