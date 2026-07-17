import useLocale from '@app/hooks/useLocale';
import axios from 'axios';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';

type DetailKind = 'music_artist' | 'music_album' | 'book';
interface CatalogItem {
  kind: DetailKind;
  provider: 'musicbrainz' | 'openlibrary';
  externalId: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  year?: number;
}
interface Edition {
  id: string;
  title: string;
  languages: string[];
  isbn: string[];
  publishDate?: string;
  publishers: string[];
}
interface Detail extends CatalogItem {
  related: CatalogItem[];
  editions: Edition[];
}

const HubDetailPage: NextPage = () => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const labels: Record<DetailKind, string> = {
    music_artist: tr('Künstler', 'Artist'),
    music_album: 'Album',
    book: tr('Buch', 'Book'),
  };
  const router = useRouter();
  const kind = Array.isArray(router.query.kind)
    ? router.query.kind[0]
    : router.query.kind;
  const id = Array.isArray(router.query.id)
    ? router.query.id[0]
    : router.query.id;
  const validKind = ['music_artist', 'music_album', 'book'].includes(kind ?? '')
    ? (kind as DetailKind)
    : undefined;
  const provider = validKind === 'book' ? 'openlibrary' : 'musicbrainz';
  const url =
    validKind && id
      ? `/api/v1/hub/items/${validKind}/${provider}/${encodeURIComponent(id)}`
      : null;
  const { data, error, isLoading } = useSWR<Detail>(url);
  const { data: preferences } = useSWR<{
    languages: string[];
    bookFormats: ('ebook' | 'audiobook')[];
  }>('/api/v1/hub/preferences');
  const [editionId, setEditionId] = useState('');
  const [formats, setFormats] = useState<('ebook' | 'audiobook')[]>([]);
  const [message, setMessage] = useState<string>();
  const selectedEdition = useMemo(
    () => data?.editions.find((edition) => edition.id === editionId),
    [data?.editions, editionId]
  );
  useEffect(() => {
    if (preferences && !formats.length) setFormats(preferences.bookFormats);
  }, [formats.length, preferences]);

  if (!validKind)
    return (
      <p className="p-6 text-red-300">
        {tr('Ungültiger Medientyp.', 'Invalid media type.')}
      </p>
    );
  if (isLoading)
    return (
      <p className="p-6 text-gray-400">
        {tr('Details werden geladen …', 'Loading details…')}
      </p>
    );
  if (error || !data)
    return (
      <p className="p-6 text-red-300">
        {tr(
          'Details sind momentan nicht verfügbar.',
          'Details are currently unavailable.'
        )}
      </p>
    );

  const request = async () => {
    if (data.kind === 'book' && data.editions.length > 1 && !editionId) {
      setMessage(
        tr(
          'Bitte wähle zuerst eine konkrete Ausgabe aus.',
          'Select a specific edition first.'
        )
      );
      return;
    }
    setMessage(undefined);
    try {
      const response = await axios.post('/api/v1/hub/requests', {
        kind: data.kind,
        provider: data.provider,
        externalId: data.externalId,
        title: data.title,
        subtitle: data.subtitle,
        imageUrl: data.imageUrl,
        ...(data.kind === 'book'
          ? {
              formats,
              editionId: editionId || data.editions[0]?.id,
              languages: selectedEdition?.languages.length
                ? selectedEdition.languages.slice(0, 5)
                : (preferences?.languages ?? ['de', 'en']),
            }
          : {}),
      });
      await mutate('/api/v1/request/count');
      setMessage(
        response.data.state === 'pending'
          ? tr(
              'Der Wunsch wartet auf Freigabe.',
              'The request is awaiting approval.'
            )
          : tr('Der Wunsch wurde übermittelt.', 'The request was submitted.')
      );
    } catch (requestError) {
      setMessage(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.message ?? requestError.message)
          : tr(
              'Der Wunsch konnte nicht gespeichert werden.',
              'The request could not be saved.'
            )
      );
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <section className="overflow-hidden rounded-2xl border border-gray-700 bg-gray-900/70">
        <div className="grid gap-6 p-6 md:grid-cols-[220px_1fr]">
          <div
            className="aspect-[2/3] rounded-lg bg-gray-800 bg-cover bg-center"
            style={
              data.imageUrl
                ? { backgroundImage: `url(${data.imageUrl})` }
                : undefined
            }
          />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-300">
              {labels[data.kind]}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white">{data.title}</h1>
            <p className="mt-2 text-gray-400">
              {[data.subtitle, data.year].filter(Boolean).join(' · ')}
            </p>
            {data.description && (
              <p className="mt-5 max-w-3xl text-gray-300">{data.description}</p>
            )}

            {data.kind === 'book' && (
              <div className="mt-6 space-y-4">
                {data.editions.length ? (
                  <label className="block max-w-2xl text-sm text-gray-300">
                    {tr('Ausgabe', 'Edition')}
                    <select
                      className="mt-1 w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2"
                      value={editionId}
                      onChange={(event) => setEditionId(event.target.value)}
                    >
                      <option value="">
                        {data.editions.length > 1
                          ? tr(
                              'Bitte konkrete Ausgabe wählen',
                              'Select a specific edition'
                            )
                          : tr(
                              'Gefundene Ausgabe verwenden',
                              'Use the detected edition'
                            )}
                      </option>
                      {data.editions.map((edition) => (
                        <option key={edition.id} value={edition.id}>
                          {[
                            edition.title,
                            edition.languages.join('/'),
                            edition.publishDate,
                            edition.isbn[0],
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-amber-300">
                    {tr(
                      'Keine eindeutig identifizierbare Ausgabe gefunden. Der Wunsch kann deshalb noch nicht sicher übermittelt werden.',
                      'No unambiguous edition was found, so this request cannot be submitted safely yet.'
                    )}
                  </p>
                )}
                <div className="flex gap-4">
                  {(['ebook', 'audiobook'] as const).map((format) => (
                    <label
                      key={format}
                      className="flex items-center gap-2 text-gray-300"
                    >
                      <input
                        type="checkbox"
                        checked={formats.includes(format)}
                        onChange={(event) =>
                          setFormats((current) =>
                            event.target.checked
                              ? [...new Set([...current, format])]
                              : current.filter((value) => value !== format)
                          )
                        }
                      />
                      {format === 'ebook'
                        ? 'E-Book'
                        : tr('Hörbuch', 'Audiobook')}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={
                data.kind === 'book' &&
                (!data.editions.length || !formats.length)
              }
              onClick={request}
              className="mt-6 rounded-md bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tr('Wünschen', 'Request')}
            </button>
            {message && <p className="mt-3 text-indigo-200">{message}</p>}
          </div>
        </div>
      </section>

      {!!data.related.length && (
        <section>
          <h2 className="mb-4 text-2xl font-semibold text-white">
            {tr('Veröffentlichungen', 'Releases')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.related.map((item) => (
              <button
                key={item.externalId}
                type="button"
                onClick={() =>
                  router.push(`/hub/${item.kind}/${item.externalId}`)
                }
                className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 text-left hover:border-indigo-500"
              >
                <p className="font-semibold text-white">{item.title}</p>
                <p className="text-sm text-gray-400">
                  {[item.subtitle, item.year].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default HubDetailPage;
