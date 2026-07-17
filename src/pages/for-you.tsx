import PageTitle from '@app/components/Common/PageTitle';
import PersonalizedCard, {
  type PersonalizedItem,
} from '@app/components/Hub/PersonalizedCard';
import {
  AdjustmentsHorizontalIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import type { NextPage } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

interface Profile {
  enabled: boolean;
  preferredMediaKinds: PersonalizedItem['kind'][];
  preferredGenres: string[];
  preferredLanguages: string[];
}

interface RecommendationResponse {
  enabled: boolean;
  shelves: { id: string; reasonCode: string; items: PersonalizedItem[] }[];
  errors: string[];
}

const labels = {
  de: {
    title: 'Für dich',
    subtitle:
      'Persönlich, nachvollziehbar und nur aus deinen lokalen Signalen.',
    mixed: 'Deine Mischung',
    movies: 'Filme für dich',
    series: 'Serien für dich',
    music: 'Musik für dich',
    books: 'Bücher für dich',
    audiobooks: 'Hörbücher für dich',
    rediscover: 'Wiederentdecken',
    disabled: 'Personalisierung ist ausgeschaltet',
    enable: 'Personalisierung einschalten',
    settings: 'Vorlieben',
  },
  en: {
    title: 'For you',
    subtitle: 'Personal, explainable, and based only on your local signals.',
    mixed: 'Your mix',
    movies: 'Movies for you',
    series: 'Series for you',
    music: 'Music for you',
    books: 'Books for you',
    audiobooks: 'Audiobooks for you',
    rediscover: 'Rediscover',
    disabled: 'Personalization is turned off',
    enable: 'Turn personalization on',
    settings: 'Preferences',
  },
} as const;

const mediaKindLabels: Record<PersonalizedItem['kind'], string> = {
  movie: 'Filme',
  tv: 'Serien',
  music_artist: 'Künstler',
  music_album: 'Alben',
  book: 'Bücher & Hörbücher',
};

const ForYouPage: NextPage = () => {
  const { locale = 'de' } = useRouter();
  const language = locale.startsWith('de') ? 'de' : 'en';
  const text = labels[language];
  const { data: profile, mutate: mutateProfile } = useSWR<Profile>(
    '/api/v1/hub/personalization/profile'
  );
  const { data, error, isLoading, mutate } = useSWR<RecommendationResponse>(
    profile?.enabled ? '/api/v1/hub/recommendations?pageSize=30' : null,
    { revalidateOnFocus: false }
  );
  const [editing, setEditing] = useState(false);
  const [genres, setGenres] = useState('');
  const [languages, setLanguages] = useState('');
  useEffect(() => {
    setGenres(profile?.preferredGenres.join(', ') ?? '');
    setLanguages(profile?.preferredLanguages.join(', ') ?? '');
  }, [profile]);

  const saveProfile = async (updates: Partial<Profile>) => {
    await axios.put('/api/v1/hub/personalization/profile', updates);
    await mutateProfile();
    await mutate();
  };
  const reset = async () => {
    if (
      !window.confirm(
        'Alle persönlichen Vorlieben, Likes und Merkliste wirklich löschen?'
      )
    )
      return;
    await axios.delete('/api/v1/hub/personalization/data');
    await mutateProfile();
    await mutate(undefined, { revalidate: false });
  };

  return (
    <div className="space-y-9 pb-14">
      <PageTitle title={text.title} />
      <header className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950 via-purple-950 to-gray-950 p-6 shadow-2xl sm:p-9">
        <Image
          src="/images/for-you-hero.svg"
          alt=""
          width={360}
          height={240}
          className="pointer-events-none absolute -right-8 -top-5 hidden opacity-60 sm:block"
          priority
        />
        <div className="relative max-w-2xl">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-300">
            <SparklesIcon className="h-5 w-5" /> PaintedClouds Beta
          </div>
          <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
            {text.title}
          </h1>
          <p className="mt-3 text-gray-300 sm:text-lg">{text.subtitle}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              onClick={() => setEditing(!editing)}
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-semibold text-gray-950"
            >
              <AdjustmentsHorizontalIcon className="h-5 w-5" />
              {text.settings}
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              <TrashIcon className="h-5 w-5" />
              Daten zurücksetzen
            </button>
          </div>
        </div>
      </header>

      {editing && profile && (
        <section
          className="rounded-2xl border border-gray-700 bg-gray-800/70 p-5"
          aria-label="Personalisierungseinstellungen"
        >
          <label className="flex items-center justify-between gap-4 font-semibold text-white">
            Personalisierung
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(event) =>
                saveProfile({ enabled: event.target.checked })
              }
              className="h-5 w-5 rounded text-indigo-600"
            />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-gray-300">
              Genres, kommagetrennt
              <input
                value={genres}
                onChange={(event) => setGenres(event.target.value)}
                className="mt-1 w-full rounded-lg border-gray-600 bg-gray-900"
              />
            </label>
            <label className="text-sm text-gray-300">
              Sprachen (z. B. de, en)
              <input
                value={languages}
                onChange={(event) => setLanguages(event.target.value)}
                className="mt-1 w-full rounded-lg border-gray-600 bg-gray-900"
              />
            </label>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm text-gray-300">
              Bevorzugte Medienarten
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(mediaKindLabels) as PersonalizedItem['kind'][]).map(
                (kind) => {
                  const active = profile.preferredMediaKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        saveProfile({
                          preferredMediaKinds: active
                            ? profile.preferredMediaKinds.filter(
                                (item) => item !== kind
                              )
                            : [...profile.preferredMediaKinds, kind],
                        })
                      }
                      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100' : 'border-gray-600 text-gray-400'}`}
                    >
                      {mediaKindLabels[kind]}
                    </button>
                  );
                }
              )}
            </div>
          </fieldset>
          <button
            onClick={() =>
              saveProfile({
                preferredGenres: genres
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                preferredLanguages: languages
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white"
          >
            Vorlieben speichern
          </button>
        </section>
      )}

      {profile && !profile.enabled ? (
        <section className="rounded-2xl border border-gray-700 bg-gray-800/60 p-8 text-center">
          <Image
            src="/images/for-you-cold-start.svg"
            alt=""
            width={240}
            height={180}
            className="mx-auto"
          />
          <h2 className="mt-4 text-2xl font-bold text-white">
            {text.disabled}
          </h2>
          <button
            onClick={() => saveProfile({ enabled: true })}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white"
          >
            {text.enable}
          </button>
        </section>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-5 text-red-200">
          Empfehlungen konnten gerade nicht geladen werden.
        </div>
      ) : isLoading ? (
        <div
          className="h-72 animate-pulse rounded-2xl bg-gray-800"
          aria-label="Empfehlungen werden geladen"
        />
      ) : data?.shelves.length ? (
        <div className="space-y-10" data-testid="for-you-feed">
          {data.shelves.map((shelf) => (
            <section key={shelf.id} aria-labelledby={`shelf-${shelf.id}`}>
              <h2
                id={`shelf-${shelf.id}`}
                className="mb-4 text-2xl font-bold text-white"
              >
                {text[shelf.id as keyof typeof text] ?? shelf.id}
              </h2>
              <div className="scrollbar-hide -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
                {shelf.items.map((item) => (
                  <PersonalizedCard
                    key={`${item.provider}-${item.kind}-${item.externalId}`}
                    item={item}
                    locale={locale}
                    onChanged={async () => {
                      await mutate();
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-gray-700 bg-gray-800/60 p-8 text-center">
          <Image
            src="/images/for-you-cold-start.svg"
            alt=""
            width={240}
            height={180}
            className="mx-auto"
          />
          <h2 className="mt-4 text-2xl font-bold text-white">
            Wähle Genres und Sprachen für deine ersten Empfehlungen.
          </h2>
        </section>
      )}
    </div>
  );
};

export default ForYouPage;
