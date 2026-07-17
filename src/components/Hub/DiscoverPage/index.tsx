import PageTitle from '@app/components/Common/PageTitle';
import useLocale from '@app/hooks/useLocale';
import {
  BookOpenIcon,
  MusicalNoteIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useState } from 'react';
import useSWR from 'swr';

type MediaSection = 'music' | 'books';

interface CatalogItem {
  kind: 'music_album' | 'book';
  provider: 'musicbrainz' | 'openlibrary';
  externalId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  year?: number;
  languages?: string[];
}

interface CatalogShelf {
  id: string;
  title: string;
  description: string;
  items: CatalogItem[];
}

interface DiscoverResponse {
  shelves: CatalogShelf[];
  errors: string[];
}

interface MusicArtist {
  id: string;
  name: string;
  type?: string;
}

interface PersonalizationProfile {
  musicGenres: string[];
  musicArtists: MusicArtist[];
}

const sectionContentDe = {
  music: {
    title: 'Musik entdecken',
    eyebrow: 'Alben & Künstler',
    description:
      'Wähle Genres, Künstler und Gruppen oder entdecke automatisch aktuelle Veröffentlichungen.',
    placeholder: 'Künstler oder Album suchen …',
    kinds: 'music_artist,music_album',
  },
  books: {
    title: 'Bücher & Hörbücher entdecken',
    eyebrow: 'Lesen & Hören',
    description:
      'Beliebte Titel und sorgfältig sortierte Genres für deine nächste Geschichte.',
    placeholder: 'Titel oder Autor suchen …',
    kinds: 'book',
  },
} as const;

const sectionContentEn = {
  music: {
    title: 'Discover music',
    eyebrow: 'Albums & artists',
    description:
      'Choose genres, artists, and groups or automatically discover current releases.',
    placeholder: 'Search for an artist or album…',
    kinds: 'music_artist,music_album',
  },
  books: {
    title: 'Discover books & audiobooks',
    eyebrow: 'Read & listen',
    description: 'Popular titles and curated genres for your next story.',
    placeholder: 'Search for a title or author…',
    kinds: 'book',
  },
} as const;

const DiscoverPage = ({ section }: { section: MediaSection }) => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const router = useRouter();
  const content = (locale === 'de' ? sectionContentDe : sectionContentEn)[
    section
  ];
  const [query, setQuery] = useState('');
  const [genreInput, setGenreInput] = useState('');
  const [artistQuery, setArtistQuery] = useState('');
  const {
    data,
    error,
    isLoading,
    mutate: refreshShelves,
  } = useSWR<DiscoverResponse>(`/api/v1/hub/discover/${section}`, {
    revalidateOnFocus: false,
    dedupingInterval: 15 * 60 * 1_000,
  });
  const { data: profile, mutate: refreshProfile } =
    useSWR<PersonalizationProfile>(
      section === 'music' ? '/api/v1/hub/personalization/profile' : null
    );
  const { data: artistOptions, isLoading: searchingArtists } = useSWR<{
    results: MusicArtist[];
  }>(
    section === 'music' && artistQuery.trim().length >= 2
      ? `/api/v1/hub/personalization/music/artists?query=${encodeURIComponent(
          artistQuery.trim()
        )}`
      : null,
    { keepPreviousData: false }
  );

  const updateMusicPreferences = async (
    updates: Partial<PersonalizationProfile>
  ) => {
    await axios.put('/api/v1/hub/personalization/profile', updates);
    await refreshProfile();
    await refreshShelves();
  };

  const addGenre = async () => {
    const genre = genreInput.trim();
    if (!genre || !profile) return;
    await updateMusicPreferences({
      musicGenres: [...new Set([...profile.musicGenres, genre])],
    });
    setGenreInput('');
  };

  const openSearch = () => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    void router.push({
      pathname: '/hub',
      query: { query: normalized, kinds: content.kinds },
    });
  };

  const Icon = section === 'music' ? MusicalNoteIcon : BookOpenIcon;

  return (
    <div className="space-y-9 pb-12">
      <PageTitle title={content.title} />
      <header
        className={`relative overflow-hidden rounded-3xl border p-6 shadow-2xl sm:p-9 ${
          section === 'music'
            ? 'border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-950 via-purple-950 to-gray-950'
            : 'border-amber-500/20 bg-gradient-to-br from-amber-950 via-orange-950 to-gray-950'
        }`}
      >
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5 blur-2xl" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
            <Icon className="h-5 w-5" /> {content.eyebrow}
          </div>
          <h1 className="mt-3 text-3xl font-bold text-white sm:text-5xl">
            {content.title}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-gray-300 sm:text-lg">
            {content.description}
          </p>
          <form
            className="mt-7 flex max-w-2xl flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              openSearch();
            }}
          >
            <input
              data-testid={`${section}-discover-search`}
              className="min-w-0 flex-1 rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-white placeholder-gray-400 outline-none transition focus:border-white/50 focus:ring-2 focus:ring-white/10"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={content.placeholder}
            />
            <button
              type="submit"
              disabled={query.trim().length < 2}
              className="rounded-xl bg-white px-6 py-3 font-semibold text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tr('Suchen', 'Search')}
            </button>
          </form>
        </div>
      </header>

      {section === 'music' && profile && (
        <section className="rounded-2xl border border-fuchsia-500/20 bg-gray-800/70 p-5 sm:p-6">
          <div className="max-w-3xl">
            <h2 className="text-xl font-bold text-white">
              {tr('Deine Musikquellen', 'Your music sources')}
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              {tr(
                'Wähle Genres und konkrete Künstler oder Gruppen. Ohne Auswahl zeigen wir automatisch die neuesten Alben, EPs und Singles.',
                'Choose genres and specific artists or groups. Without a selection, we automatically show the latest albums, EPs, and singles.'
              )}
            </p>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <label
                htmlFor="music-genre"
                className="text-sm font-semibold text-gray-200"
              >
                Genres
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="music-genre"
                  value={genreInput}
                  onChange={(event) => setGenreInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addGenre();
                    }
                  }}
                  placeholder={tr(
                    'z. B. Metal, Jazz, K-Pop',
                    'e.g. metal, jazz, K-pop'
                  )}
                  className="min-w-0 flex-1 rounded-lg border-gray-600 bg-gray-900"
                />
                <button
                  type="button"
                  onClick={() => void addGenre()}
                  disabled={!genreInput.trim()}
                  className="rounded-lg bg-fuchsia-600 p-2.5 text-white disabled:opacity-40"
                  aria-label={tr('Genre hinzufügen', 'Add genre')}
                >
                  <PlusIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.musicGenres.map((genre) => (
                  <span
                    key={genre}
                    className="flex items-center gap-1 rounded-full bg-fuchsia-500/20 px-3 py-1 text-sm text-fuchsia-100"
                  >
                    {genre}
                    <button
                      type="button"
                      onClick={() =>
                        void updateMusicPreferences({
                          musicGenres: profile.musicGenres.filter(
                            (item) => item !== genre
                          ),
                        })
                      }
                      aria-label={tr(`${genre} entfernen`, `Remove ${genre}`)}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="relative">
              <label
                htmlFor="music-artist"
                className="text-sm font-semibold text-gray-200"
              >
                {tr('Künstler und Gruppen', 'Artists and groups')}
              </label>
              <input
                id="music-artist"
                value={artistQuery}
                onChange={(event) => setArtistQuery(event.target.value)}
                placeholder={tr(
                  'Künstler oder Band suchen …',
                  'Search for an artist or band…'
                )}
                className="mt-2 w-full rounded-lg border-gray-600 bg-gray-900"
              />
              {artistQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-600 bg-gray-900 shadow-2xl">
                  {searchingArtists ? (
                    <p className="p-3 text-sm text-gray-400">
                      {tr('Suche …', 'Searching…')}
                    </p>
                  ) : artistOptions?.results.length ? (
                    artistOptions.results.map((artist) => (
                      <button
                        key={artist.id}
                        type="button"
                        className="flex w-full items-center justify-between border-b border-gray-700 px-3 py-2 text-left last:border-0 hover:bg-gray-800"
                        onClick={() => {
                          void updateMusicPreferences({
                            musicArtists: [
                              ...profile.musicArtists.filter(
                                (item) => item.id !== artist.id
                              ),
                              artist,
                            ],
                          });
                          setArtistQuery('');
                        }}
                      >
                        <span className="text-white">{artist.name}</span>
                        <span className="text-xs text-gray-400">
                          {artist.type ?? tr('Künstler', 'Artist')}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-3 text-sm text-gray-400">
                      {tr('Keine Künstler gefunden.', 'No artists found.')}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.musicArtists.map((artist) => (
                  <span
                    key={artist.id}
                    className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-1 text-sm text-indigo-100"
                  >
                    {artist.name}
                    <button
                      type="button"
                      onClick={() =>
                        void updateMusicPreferences({
                          musicArtists: profile.musicArtists.filter(
                            (item) => item.id !== artist.id
                          ),
                        })
                      }
                      aria-label={tr(
                        `${artist.name} entfernen`,
                        `Remove ${artist.name}`
                      )}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-5 text-red-200">
          {tr(
            'Die Vorschläge konnten gerade nicht geladen werden. Die Suche oben funktioniert weiterhin.',
            'Suggestions could not be loaded. The search above is still available.'
          )}
        </div>
      ) : isLoading ? (
        <div
          className="space-y-8"
          aria-label={tr('Vorschläge werden geladen', 'Loading suggestions')}
        >
          {[0, 1, 2].map((shelf) => (
            <div key={shelf}>
              <div className="mb-4 h-7 w-52 animate-pulse rounded bg-gray-800" />
              <div className="flex gap-4 overflow-hidden">
                {[0, 1, 2, 3, 4, 5].map((card) => (
                  <div
                    key={card}
                    className={`flex-none animate-pulse rounded-2xl bg-gray-800 ${
                      section === 'music' ? 'h-72 w-52' : 'h-80 w-44'
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-10" data-testid={`${section}-discover-shelves`}>
          {data?.shelves.map((shelf) => (
            <section key={shelf.id}>
              <div className="mb-4">
                <h2 className="text-2xl font-bold text-white">{shelf.title}</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {shelf.description}
                </p>
              </div>
              <div className="scrollbar-hide -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
                {shelf.items.map((item) => (
                  <article
                    key={`${shelf.id}-${item.externalId}`}
                    data-testid={`${section}-discover-card`}
                    className={`group flex-none snap-start overflow-hidden rounded-2xl border border-gray-700 bg-gray-800/70 shadow-lg transition hover:-translate-y-1 hover:border-gray-500 hover:shadow-2xl ${
                      section === 'music' ? 'w-52' : 'w-44 sm:w-48'
                    }`}
                  >
                    <div
                      className={`relative overflow-hidden bg-gradient-to-br from-gray-700 to-gray-950 ${
                        section === 'music' ? 'aspect-square' : 'aspect-[2/3]'
                      }`}
                    >
                      {item.imageUrl && (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          fill
                          sizes={section === 'music' ? '208px' : '192px'}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                      {!item.imageUrl && (
                        <Icon className="absolute inset-0 m-auto h-14 w-14 text-white/20" />
                      )}
                    </div>
                    <div className="space-y-3 p-3">
                      <div className="min-h-16">
                        <h3 className="line-clamp-2 font-semibold text-white">
                          {item.title}
                        </h3>
                        <p className="mt-1 line-clamp-1 text-xs text-gray-400">
                          {[item.subtitle, item.year]
                            .filter(Boolean)
                            .join(' · ') ||
                            tr('Keine Zusatzangaben', 'No additional details')}
                        </p>
                      </div>
                      <button
                        className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                        onClick={() =>
                          router.push(`/hub/${item.kind}/${item.externalId}`)
                        }
                      >
                        {tr('Details & Wunsch', 'Details & request')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!!data?.errors.length && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-950/30 p-3 text-sm text-amber-200">
              {tr(
                'Einzelne Vorschlagsreihen konnten vorübergehend nicht geladen werden.',
                'Some suggestion shelves could not be loaded temporarily.'
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default DiscoverPage;
