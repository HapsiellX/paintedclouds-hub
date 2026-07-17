import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { HubMediaKind } from '@server/constants/hub';
import { getSettings } from '@server/lib/settings';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';

export interface HubCatalogItem {
  kind: HubMediaKind;
  provider: 'tmdb' | 'musicbrainz' | 'openlibrary';
  externalId: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  year?: number;
  releaseDate?: string;
  languages?: string[];
  genres?: string[];
  formats?: ('ebook' | 'audiobook')[];
  popularity?: number;
  freshness?: number;
  available?: boolean;
  requested?: boolean;
  downloading?: boolean;
  saved?: boolean;
  liked?: boolean;
  hidden?: boolean;
  recommendationReasons?: { code: string; context?: string }[];
}

export interface HubCatalogShelf {
  id: string;
  title: string;
  description: string;
  items: HubCatalogItem[];
}

export interface HubCatalogEdition {
  id: string;
  title: string;
  languages: string[];
  isbn: string[];
  publishDate?: string;
  publishers: string[];
}

export interface HubCatalogDetail extends HubCatalogItem {
  related: HubCatalogItem[];
  editions: HubCatalogEdition[];
}

interface MusicBrainzArtistResponse {
  artists?: {
    id: string;
    name: string;
    type?: string;
    disambiguation?: string;
    country?: string;
  }[];
}

export interface HubMusicArtistPreference {
  id: string;
  name: string;
  type?: string;
}

interface MusicBrainzReleaseResponse {
  'release-groups'?: {
    id: string;
    title: string;
    'first-release-date'?: string;
    'artist-credit'?: { name: string }[];
    'primary-type'?: string;
  }[];
}

interface OpenLibraryResponse {
  docs?: {
    key: string;
    title: string;
    author_name?: string[];
    first_publish_year?: number;
    cover_i?: number;
    language?: string[];
  }[];
}

interface OpenLibraryWorksResponse {
  works?: {
    key: string;
    title: string;
    author_name?: string[];
    authors?: { name: string }[];
    first_publish_year?: number;
    cover_i?: number;
    cover_id?: number;
    language?: string[];
  }[];
}

interface MusicBrainzArtistDetail {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
}

interface MusicBrainzReleaseGroupDetail {
  id: string;
  title: string;
  'artist-credit'?: { name: string }[];
  'first-release-date'?: string;
}

interface OpenLibraryWorkDetail {
  key: string;
  title: string;
  covers?: number[];
  authors?: { author?: { key?: string } }[];
}

interface OpenLibraryAuthorDetail {
  name?: string;
}

interface HubCatalogClients {
  musicBrainz: Pick<AxiosInstance, 'get'>;
  openLibrary: Pick<AxiosInstance, 'get'>;
}

export class HubCatalogItemNotFoundError extends Error {}

const metadataIdentity = () => {
  const metadata = getSettings().hub.metadata;
  const contactEmail = metadata.contactEmail.trim();
  return {
    contactEmail,
    userAgent:
      metadata.userAgent.trim() ||
      `PaintedCloudsHub/0.2${contactEmail ? ` (mailto:${contactEmail})` : ''}`,
  };
};

const musicBrainz = rateLimit(
  axios.create({
    baseURL: 'https://musicbrainz.org/ws/2',
    timeout: 10_000,
    headers: {
      'User-Agent': 'PaintedCloudsHub/0.2',
    },
  }),
  { maxRequests: 1, perMilliseconds: 1_000 }
);

const openLibrary = rateLimit(
  axios.create({
    baseURL: 'https://openlibrary.org',
    timeout: 10_000,
    headers: {
      'User-Agent': 'PaintedCloudsHub/0.2',
    },
  }),
  { maxRequests: 3, perMilliseconds: 1_000 }
);

musicBrainz.interceptors.request.use((config) => {
  config.headers.set('User-Agent', metadataIdentity().userAgent);
  return config;
});
openLibrary.interceptors.request.use((config) => {
  const identity = metadataIdentity();
  config.headers.set('User-Agent', identity.userAgent);
  config.params = {
    ...(typeof config.params === 'object' ? config.params : {}),
    ...(identity.contactEmail ? { email: identity.contactEmail } : {}),
  };
  return config;
});

const searchVideo = async (
  query: string,
  language: string
): Promise<HubCatalogItem[]> => {
  const response = await new TheMovieDb().searchMulti({
    query,
    language,
    page: 1,
  });

  return response.results
    .filter(
      (item): item is TmdbMovieResult | TmdbTvResult =>
        item.media_type === 'movie' || item.media_type === 'tv'
    )
    .slice(0, 12)
    .map((item) => {
      const title =
        'title' in item ? item.title : 'name' in item ? item.name : 'Unbekannt';
      const date =
        'release_date' in item
          ? item.release_date
          : 'first_air_date' in item
            ? item.first_air_date
            : undefined;
      return {
        kind:
          item.media_type === 'movie' ? HubMediaKind.MOVIE : HubMediaKind.TV,
        provider: 'tmdb' as const,
        externalId: String(item.id),
        title,
        description: item.overview,
        imageUrl: item.poster_path
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : undefined,
        year: date ? Number(date.slice(0, 4)) : undefined,
      };
    });
};

const searchMusic = async (query: string): Promise<HubCatalogItem[]> => {
  const [artists, releases] = await Promise.all([
    musicBrainz.get<MusicBrainzArtistResponse>('/artist', {
      params: { query, fmt: 'json', limit: 8 },
    }),
    musicBrainz.get<MusicBrainzReleaseResponse>('/release-group', {
      params: { query, fmt: 'json', limit: 12 },
    }),
  ]);

  return [
    ...(artists.data.artists ?? []).map((artist) => ({
      kind: HubMediaKind.MUSIC_ARTIST,
      provider: 'musicbrainz' as const,
      externalId: artist.id,
      title: artist.name,
      subtitle: [artist.disambiguation, artist.country]
        .filter(Boolean)
        .join(' · '),
    })),
    ...(releases.data['release-groups'] ?? []).map((album) => ({
      kind: HubMediaKind.MUSIC_ALBUM,
      provider: 'musicbrainz' as const,
      externalId: album.id,
      title: album.title,
      subtitle: (album['artist-credit'] ?? [])
        .map((credit) => credit.name)
        .join(', '),
      imageUrl: `https://coverartarchive.org/release-group/${album.id}/front-500`,
      year: album['first-release-date']
        ? Number(album['first-release-date'].slice(0, 4))
        : undefined,
    })),
  ];
};

const searchBooks = async (query: string): Promise<HubCatalogItem[]> => {
  const response = await openLibrary.get<OpenLibraryResponse>('/search.json', {
    params: {
      q: query,
      limit: 20,
      fields: 'key,title,author_name,first_publish_year,cover_i,language',
    },
  });

  return (response.data.docs ?? []).map((book) => ({
    kind: HubMediaKind.BOOK,
    provider: 'openlibrary' as const,
    externalId: book.key.replace('/works/', ''),
    title: book.title,
    subtitle: (book.author_name ?? []).join(', '),
    imageUrl: book.cover_i
      ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
      : undefined,
    year: book.first_publish_year,
    languages: book.language,
  }));
};

const mapReleaseGroups = (
  albums: NonNullable<MusicBrainzReleaseResponse['release-groups']>
): HubCatalogItem[] =>
  albums.map((album) => ({
    kind: HubMediaKind.MUSIC_ALBUM,
    provider: 'musicbrainz' as const,
    externalId: album.id,
    title: album.title,
    subtitle: (album['artist-credit'] ?? [])
      .map((credit) => credit.name)
      .join(', '),
    imageUrl: `https://coverartarchive.org/release-group/${album.id}/front-500`,
    year: album['first-release-date']
      ? Number(album['first-release-date'].slice(0, 4))
      : undefined,
    releaseDate: album['first-release-date'],
    freshness: freshnessFromDate(album['first-release-date']),
  }));

const freshnessFromDate = (value?: string) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, Date.now() - timestamp) / 86_400_000;
  return Math.max(0, 1 - ageDays / 180);
};

const discoverMusicShelf = async ({
  id,
  title,
  description,
  query,
  genreTags,
}: Omit<HubCatalogShelf, 'items'> & {
  query: string;
  genreTags?: string[];
}): Promise<HubCatalogShelf> => {
  const response = await musicBrainz.get<MusicBrainzReleaseResponse>(
    '/release-group',
    { params: { query, fmt: 'json', limit: 100 } }
  );
  return {
    id,
    title,
    description,
    items: mapReleaseGroups(response.data['release-groups'] ?? [])
      .sort((left, right) =>
        (right.releaseDate ?? '').localeCompare(left.releaseDate ?? '')
      )
      .slice(0, 18)
      .map((item) => ({ ...item, genres: genreTags ?? [], popularity: 75 })),
  };
};

const mapOpenLibraryWorks = (
  works: NonNullable<OpenLibraryWorksResponse['works']>
): HubCatalogItem[] =>
  works.map((book) => {
    const coverId = book.cover_i ?? book.cover_id;
    return {
      kind: HubMediaKind.BOOK,
      provider: 'openlibrary' as const,
      externalId: book.key.replace('/works/', ''),
      title: book.title,
      subtitle: (
        book.author_name ??
        book.authors?.map((author) => author.name) ??
        []
      ).join(', '),
      imageUrl: coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
        : undefined,
      year: book.first_publish_year,
      languages: book.language,
    };
  });

const discoverBookShelf = async ({
  id,
  title,
  description,
  path,
}: Omit<HubCatalogShelf, 'items'> & {
  path: string;
}): Promise<HubCatalogShelf> => {
  const response = await openLibrary.get<OpenLibraryWorksResponse>(path, {
    params: { limit: 18 },
  });
  return {
    id,
    title,
    description,
    items: mapOpenLibraryWorks(response.data.works ?? []).map((item) => ({
      ...item,
      genres: id === 'trending' ? [] : [id],
      formats: ['ebook', 'audiobook'],
      popularity: id === 'trending' ? 100 : 50,
    })),
  };
};

const settledShelves = async (
  shelves: Promise<HubCatalogShelf>[]
): Promise<{ shelves: HubCatalogShelf[]; errors: string[] }> => {
  const settled = await Promise.allSettled(shelves);
  return {
    shelves: settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    ),
    errors: settled.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason?.message)] : []
    ),
  };
};

const translate = (locale: string, de: string, en: string) =>
  locale.toLowerCase().startsWith('de') ? de : en;

const musicReleaseDateRange = (now = new Date()) => {
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  return `${start.toISOString().slice(0, 10)} TO ${end
    .toISOString()
    .slice(0, 10)}`;
};

const escapeLucenePhrase = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const buildHubRecentMusicQuery = (
  filter?: { genre?: string; artistId?: string },
  now = new Date()
) => {
  const clauses = [
    `firstreleasedate:[${musicReleaseDateRange(now)}]`,
    'primarytype:(album OR single OR ep)',
  ];
  if (filter?.genre) clauses.push(`tag:"${escapeLucenePhrase(filter.genre)}"`);
  if (filter?.artistId) clauses.push(`arid:${filter.artistId}`);
  return clauses.join(' AND ');
};

const slug = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48);

const discoverMusicShelves = ({
  genres,
  artists,
  locale,
}: {
  genres: string[];
  artists: HubMusicArtistPreference[];
  locale: string;
}) => {
  const shelves: Promise<HubCatalogShelf>[] = [
    ...genres.map((genre) =>
      discoverMusicShelf({
        id: `genre-${slug(genre)}`,
        title: translate(locale, `Neu in ${genre}`, `New in ${genre}`),
        description: translate(
          locale,
          `Aktuelle Alben, EPs und Singles aus ${genre}`,
          `Current albums, EPs, and singles from ${genre}`
        ),
        query: buildHubRecentMusicQuery({ genre }),
        genreTags: [genre],
      })
    ),
    ...artists.map((artist) =>
      discoverMusicShelf({
        id: `artist-${artist.id}`,
        title: translate(
          locale,
          `Neu von ${artist.name}`,
          `New from ${artist.name}`
        ),
        description: translate(
          locale,
          `Aktuelle Veröffentlichungen von ${artist.name}`,
          `Current releases from ${artist.name}`
        ),
        query: buildHubRecentMusicQuery({ artistId: artist.id }),
      })
    ),
  ];
  if (!shelves.length) {
    shelves.push(
      discoverMusicShelf({
        id: 'latest-music',
        title: translate(locale, 'Aktuelle Musik', 'Current music'),
        description: translate(
          locale,
          'Neue und derzeit relevante Alben, EPs und Singles',
          'New and currently relevant albums, EPs, and singles'
        ),
        query: buildHubRecentMusicQuery(),
      })
    );
  }
  return settledShelves(shelves);
};

const discoverBookShelves = (locale: string) =>
  settledShelves([
    discoverBookShelf({
      id: 'trending',
      title: translate(locale, 'Gerade beliebt', 'Trending now'),
      description: translate(
        locale,
        'Aktuell häufig entdeckte Bücher',
        'Books readers are discovering now'
      ),
      path: '/trending/daily.json',
    }),
    discoverBookShelf({
      id: 'science-fiction',
      title: 'Science-Fiction',
      description: translate(
        locale,
        'Ferne Welten, Zukunft und große Ideen',
        'Distant worlds, futures, and big ideas'
      ),
      path: '/subjects/science_fiction.json',
    }),
    discoverBookShelf({
      id: 'fantasy',
      title: 'Fantasy',
      description: translate(
        locale,
        'Magische Welten und epische Abenteuer',
        'Magical worlds and epic adventures'
      ),
      path: '/subjects/fantasy.json',
    }),
    discoverBookShelf({
      id: 'thrillers',
      title: 'Thriller & Mystery',
      description: translate(
        locale,
        'Spannung, Rätsel und dunkle Geheimnisse',
        'Suspense, mysteries, and dark secrets'
      ),
      path: '/subjects/thriller.json',
    }),
  ]);

type DiscoveryResult = Awaited<ReturnType<typeof settledShelves>>;
const discoveryCache = new Map<
  string,
  { expiresAt: number; value: DiscoveryResult }
>();

const cachedDiscovery = async (
  section: string,
  load: () => Promise<DiscoveryResult>
): Promise<DiscoveryResult> => {
  const cached = discoveryCache.get(section);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await load();
  discoveryCache.set(section, {
    expiresAt: Date.now() + 60 * 60 * 1_000,
    value,
  });
  return value;
};

export const discoverHubMusic = ({
  genres = [],
  artists = [],
  locale = 'de',
}: {
  genres?: string[];
  artists?: HubMusicArtistPreference[];
  locale?: string;
} = {}) => {
  const normalizedGenres = [...new Set(genres.map((genre) => genre.trim()))]
    .filter(Boolean)
    .sort();
  const normalizedArtists = [...artists]
    .filter((artist) => /^[0-9a-f-]{36}$/i.test(artist.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const key = `music:${locale}:${normalizedGenres.join('|')}:${normalizedArtists
    .map((artist) => artist.id)
    .join('|')}`;
  return cachedDiscovery(key, () =>
    discoverMusicShelves({
      genres: normalizedGenres,
      artists: normalizedArtists,
      locale,
    })
  );
};

export const discoverHubBooks = (locale = 'de') =>
  cachedDiscovery(`books:${locale}`, () => discoverBookShelves(locale));

export const searchHubMusicArtists = async (
  query: string
): Promise<HubMusicArtistPreference[]> => {
  const response = await musicBrainz.get<MusicBrainzArtistResponse>('/artist', {
    params: { query, fmt: 'json', limit: 12 },
  });
  return (response.data.artists ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    type: artist.type,
  }));
};

const majorStreamingProviderNames = new Set([
  'netflix',
  'amazon prime video',
  'disney plus',
  'apple tv plus',
  'paramount plus',
  'wow',
  'max',
  'crunchyroll',
  'crunchyroll amazon channel',
  'crunchyroll apple tv channel',
]);

export const selectMajorStreamingProviderIds = (
  providers: { provider_id: number; provider_name: string }[]
) =>
  providers
    .filter((provider) =>
      majorStreamingProviderNames.has(provider.provider_name.toLowerCase())
    )
    .map((provider) => provider.provider_id);

interface ProviderRuntimeState {
  consecutiveFailures: number;
  circuitOpenUntil?: number;
  lastSuccess?: number;
  errors: { at: number; code: 'PROVIDER_UNAVAILABLE' }[];
}

const providerRuntime = new Map<
  'tmdb' | 'musicbrainz' | 'openlibrary',
  ProviderRuntimeState
>();

const providerCall = async <T>(
  provider: 'tmdb' | 'musicbrainz' | 'openlibrary',
  load: () => Promise<T>
): Promise<T> => {
  const state = providerRuntime.get(provider) ?? {
    consecutiveFailures: 0,
    errors: [],
  };
  providerRuntime.set(provider, state);
  if (state.circuitOpenUntil && state.circuitOpenUntil > Date.now())
    throw new Error('PROVIDER_CIRCUIT_OPEN');
  try {
    const value = await load();
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = undefined;
    state.lastSuccess = Date.now();
    return value;
  } catch {
    state.consecutiveFailures += 1;
    state.errors = [
      { at: Date.now(), code: 'PROVIDER_UNAVAILABLE' as const },
      ...state.errors,
    ].slice(0, 20);
    if (state.consecutiveFailures >= 3)
      state.circuitOpenUntil = Date.now() + 5 * 60 * 1_000;
    throw new Error('PROVIDER_UNAVAILABLE');
  }
};

export const getHubProviderHealth = () =>
  (['tmdb', 'musicbrainz', 'openlibrary'] as const).map((provider) => {
    const state = providerRuntime.get(provider);
    return {
      provider,
      healthy: !state?.circuitOpenUntil || state.circuitOpenUntil <= Date.now(),
      lastSuccess: state?.lastSuccess ? new Date(state.lastSuccess) : null,
      circuitOpenUntil: state?.circuitOpenUntil
        ? new Date(state.circuitOpenUntil)
        : null,
      errorHistory:
        state?.errors.map((error) => ({
          at: new Date(error.at),
          code: error.code,
        })) ?? [],
    };
  });

const mapTrendingMovie = (item: TmdbMovieResult): HubCatalogItem => ({
  kind: HubMediaKind.MOVIE,
  provider: 'tmdb',
  externalId: String(item.id),
  title: item.title,
  description: item.overview,
  imageUrl: item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : undefined,
  year: item.release_date
    ? Number(item.release_date.slice(0, 4)) || undefined
    : undefined,
  releaseDate: item.release_date,
  freshness: freshnessFromDate(item.release_date),
  languages: item.original_language ? [item.original_language] : undefined,
  genres: (item.genre_ids ?? []).map(String),
  popularity: item.popularity,
});

const mapTrendingTv = (item: TmdbTvResult): HubCatalogItem => ({
  kind: HubMediaKind.TV,
  provider: 'tmdb',
  externalId: String(item.id),
  title: item.name,
  description: item.overview,
  imageUrl: item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : undefined,
  year: item.first_air_date
    ? Number(item.first_air_date.slice(0, 4)) || undefined
    : undefined,
  releaseDate: item.first_air_date,
  freshness: freshnessFromDate(item.first_air_date),
  languages: item.original_language ? [item.original_language] : undefined,
  genres: (item.genre_ids ?? []).map(String),
  popularity: item.popularity,
});

export const loadHubRecommendationCandidates = async (
  language: string,
  librarySeeds: {
    kind: HubMediaKind.MOVIE | HubMediaKind.TV;
    id: number;
  }[] = [],
  musicPreferences: {
    genres?: string[];
    artists?: HubMusicArtistPreference[];
  } = {},
  watchRegion = 'DE'
): Promise<{ items: HubCatalogItem[]; errors: string[] }> => {
  const cacheKey = `${language.toLowerCase()}:${watchRegion.toUpperCase()}:${librarySeeds
    .map((seed) => `${seed.kind}:${seed.id}`)
    .sort()
    .join(',')}:${[...(musicPreferences.genres ?? [])].sort().join(',')}:${[
    ...(musicPreferences.artists ?? []),
  ]
    .map((artist) => artist.id)
    .sort()
    .join(',')}`;
  const cachedCandidates = recommendationCandidateCache.get(cacheKey);
  if (cachedCandidates && cachedCandidates.expiresAt > Date.now())
    return cachedCandidates.value;
  const tmdb = new TheMovieDb();
  const today = new Date();
  const recentDate = new Date(today);
  recentDate.setUTCDate(recentDate.getUTCDate() - 120);
  const dateRange = {
    from: recentDate.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
  const loadCurrentStreamingTv = async () => {
    const providers = await tmdb.getTvWatchProviders({
      language,
      watchRegion,
    });
    const providerIds = selectMajorStreamingProviderIds(providers).join('|');
    if (!providerIds)
      return { page: 1, total_pages: 0, total_results: 0, results: [] };
    return tmdb.getDiscoverTv({
      language,
      airDateGte: dateRange.from,
      airDateLte: dateRange.to,
      sortBy: 'popularity.desc',
      voteAverageGte: '7',
      voteCountGte: '50',
      watchProviders: providerIds,
      watchMonetizationTypes: 'flatrate',
      watchRegion,
      originalLanguage: 'all',
    });
  };
  const sources = await Promise.allSettled([
    providerCall('tmdb', () =>
      tmdb.getDiscoverMovies({
        language,
        primaryReleaseDateGte: dateRange.from,
        primaryReleaseDateLte: dateRange.to,
        sortBy: 'popularity.desc',
        voteCountGte: '50',
        originalLanguage: 'all',
      })
    ),
    providerCall('tmdb', loadCurrentStreamingTv),
    providerCall('musicbrainz', () =>
      discoverHubMusic({
        genres: musicPreferences.genres,
        artists: musicPreferences.artists,
      })
    ),
    providerCall('openlibrary', discoverHubBooks),
  ]);
  const items: HubCatalogItem[] = [];
  if (sources[0].status === 'fulfilled')
    items.push(...sources[0].value.results.map(mapTrendingMovie));
  if (sources[1].status === 'fulfilled')
    items.push(...sources[1].value.results.map(mapTrendingTv));
  if (sources[2].status === 'fulfilled')
    items.push(...sources[2].value.shelves.flatMap((shelf) => shelf.items));
  if (sources[3].status === 'fulfilled')
    items.push(...sources[3].value.shelves.flatMap((shelf) => shelf.items));
  const movieSeed = librarySeeds.find(
    (seed) => seed.kind === HubMediaKind.MOVIE
  );
  const tvSeed = librarySeeds.find((seed) => seed.kind === HubMediaKind.TV);
  const related = await Promise.allSettled([
    movieSeed
      ? providerCall('tmdb', () =>
          tmdb.getMovieRecommendations({
            movieId: movieSeed.id,
            language,
          })
        )
      : Promise.resolve(undefined),
    movieSeed
      ? providerCall('tmdb', () =>
          tmdb.getMovieSimilar({ movieId: movieSeed.id, language })
        )
      : Promise.resolve(undefined),
    tvSeed
      ? providerCall('tmdb', () =>
          tmdb.getTvRecommendations({ tvId: tvSeed.id, language })
        )
      : Promise.resolve(undefined),
    tvSeed
      ? providerCall('tmdb', () =>
          tmdb.getTvSimilar({ tvId: tvSeed.id, language })
        )
      : Promise.resolve(undefined),
  ]);
  for (const result of [related[0], related[1]]) {
    if (result.status === 'fulfilled' && result.value)
      items.push(
        ...result.value.results
          .filter(
            (item) => !item.release_date || item.release_date >= dateRange.from
          )
          .map(mapTrendingMovie)
      );
  }
  for (const result of [related[2], related[3]]) {
    if (result.status === 'fulfilled' && result.value)
      items.push(
        ...result.value.results
          .filter(
            (item) =>
              !item.first_air_date || item.first_air_date >= dateRange.from
          )
          .map(mapTrendingTv)
      );
  }
  const value = {
    items,
    errors: [...sources, ...related].flatMap((source) =>
      source.status === 'rejected' ? ['PROVIDER_UNAVAILABLE'] : []
    ),
  };
  if (items.length) {
    recommendationCandidateCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + 60 * 60 * 1_000,
    });
    return value;
  }
  return cachedCandidates
    ? { ...cachedCandidates.value, errors: ['CACHE_FALLBACK'] }
    : value;
};

const recommendationCandidateCache = new Map<
  string,
  {
    value: { items: HubCatalogItem[]; errors: string[] };
    expiresAt: number;
  }
>();

export const searchHubCatalog = async ({
  query,
  kinds,
  language,
}: {
  query: string;
  kinds: HubMediaKind[];
  language: string;
}): Promise<{ results: HubCatalogItem[]; errors: string[] }> => {
  const includeVideo = kinds.some((kind) =>
    [HubMediaKind.MOVIE, HubMediaKind.TV].includes(kind)
  );
  const includeMusic = kinds.some((kind) =>
    [HubMediaKind.MUSIC_ARTIST, HubMediaKind.MUSIC_ALBUM].includes(kind)
  );
  const includeBooks = kinds.includes(HubMediaKind.BOOK);
  const searches = [
    includeVideo ? searchVideo(query, language) : Promise.resolve([]),
    includeMusic ? searchMusic(query) : Promise.resolve([]),
    includeBooks ? searchBooks(query) : Promise.resolve([]),
  ];
  const settled = await Promise.allSettled(searches);
  const errors = settled
    .filter((result) => result.status === 'rejected')
    .map((result) =>
      result.status === 'rejected' ? String(result.reason?.message) : ''
    );
  const results = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  return {
    results: results.filter((item) => kinds.includes(item.kind)),
    errors,
  };
};

const canonicalText = (
  value: unknown,
  maximumLength: number
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : undefined;
};

const resolveOpenLibraryAuthors = async (
  work: OpenLibraryWorkDetail,
  client: HubCatalogClients['openLibrary']
): Promise<string | undefined> => {
  const authorKeys = (work.authors ?? [])
    .flatMap((entry) => (entry.author?.key ? [entry.author.key] : []))
    .filter((key) => /^\/authors\/OL\d+A$/i.test(key))
    .slice(0, 5);
  const authors = await Promise.allSettled(
    authorKeys.map(async (key) => {
      const response = await client.get<OpenLibraryAuthorDetail>(`${key}.json`);
      return canonicalText(response.data.name, 200);
    })
  );
  return canonicalText(
    authors
      .flatMap((author) =>
        author.status === 'fulfilled' && author.value ? [author.value] : []
      )
      .join(', '),
    500
  );
};

export const resolveHubCatalogItem = async (
  input: {
    kind: HubMediaKind;
    provider: 'musicbrainz' | 'openlibrary';
    externalId: string;
  },
  clients: HubCatalogClients = { musicBrainz, openLibrary }
): Promise<HubCatalogItem> => {
  const musicId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validIdentity =
    (input.provider === 'musicbrainz' &&
      (input.kind === HubMediaKind.MUSIC_ARTIST ||
        input.kind === HubMediaKind.MUSIC_ALBUM) &&
      musicId.test(input.externalId)) ||
    (input.provider === 'openlibrary' &&
      input.kind === HubMediaKind.BOOK &&
      /^OL\d+W$/i.test(input.externalId));
  if (!validIdentity) throw new HubCatalogItemNotFoundError();

  try {
    if (
      input.provider === 'musicbrainz' &&
      input.kind === HubMediaKind.MUSIC_ARTIST
    ) {
      const response = await clients.musicBrainz.get<MusicBrainzArtistDetail>(
        `/artist/${encodeURIComponent(input.externalId)}`,
        { params: { fmt: 'json' } }
      );
      const title = canonicalText(response.data.name, 500);
      if (
        response.data.id.toLowerCase() !== input.externalId.toLowerCase() ||
        !title
      ) {
        throw new HubCatalogItemNotFoundError();
      }
      return {
        kind: input.kind,
        provider: input.provider,
        externalId: response.data.id.toLowerCase(),
        title,
        subtitle: canonicalText(
          [response.data.disambiguation, response.data.country]
            .filter(Boolean)
            .join(' · '),
          500
        ),
      };
    }

    if (
      input.provider === 'musicbrainz' &&
      input.kind === HubMediaKind.MUSIC_ALBUM
    ) {
      const response =
        await clients.musicBrainz.get<MusicBrainzReleaseGroupDetail>(
          `/release-group/${encodeURIComponent(input.externalId)}`,
          { params: { fmt: 'json' } }
        );
      const title = canonicalText(response.data.title, 500);
      if (
        response.data.id.toLowerCase() !== input.externalId.toLowerCase() ||
        !title
      ) {
        throw new HubCatalogItemNotFoundError();
      }
      return {
        kind: input.kind,
        provider: input.provider,
        externalId: response.data.id.toLowerCase(),
        title,
        subtitle: canonicalText(
          (response.data['artist-credit'] ?? [])
            .map((credit) => credit.name)
            .join(', '),
          500
        ),
        imageUrl: `https://coverartarchive.org/release-group/${response.data.id.toLowerCase()}/front-500`,
        year: response.data['first-release-date']
          ? Number(response.data['first-release-date'].slice(0, 4)) || undefined
          : undefined,
      };
    }

    if (input.provider === 'openlibrary' && input.kind === HubMediaKind.BOOK) {
      const response = await clients.openLibrary.get<OpenLibraryWorkDetail>(
        `/works/${encodeURIComponent(input.externalId)}.json`
      );
      const title = canonicalText(response.data.title, 500);
      if (
        response.data.key.toUpperCase() !==
          `/works/${input.externalId}`.toUpperCase() ||
        !title
      ) {
        throw new HubCatalogItemNotFoundError();
      }
      const coverId = response.data.covers?.find(
        (cover) => Number.isInteger(cover) && cover > 0
      );
      return {
        kind: input.kind,
        provider: input.provider,
        externalId: response.data.key.replace('/works/', '').toUpperCase(),
        title,
        subtitle: await resolveOpenLibraryAuthors(
          response.data,
          clients.openLibrary
        ),
        imageUrl: coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
          : undefined,
      };
    }

    throw new HubCatalogItemNotFoundError();
  } catch (error) {
    if (
      error instanceof HubCatalogItemNotFoundError ||
      (axios.isAxiosError(error) && error.response?.status === 404)
    ) {
      throw new HubCatalogItemNotFoundError();
    }
    throw error;
  }
};

export const resolveHubCatalogDetail = async (
  input: Parameters<typeof resolveHubCatalogItem>[0]
): Promise<HubCatalogDetail> => {
  const item = await resolveHubCatalogItem(input);
  if (input.kind === HubMediaKind.MUSIC_ARTIST) {
    const response = await musicBrainz.get<MusicBrainzReleaseResponse>(
      '/release-group',
      { params: { artist: item.externalId, fmt: 'json', limit: 50 } }
    );
    return {
      ...item,
      related: mapReleaseGroups(response.data['release-groups'] ?? []),
      editions: [],
    };
  }
  if (input.kind === HubMediaKind.MUSIC_ALBUM) {
    return { ...item, related: [], editions: [] };
  }
  const response = await openLibrary.get<{
    entries?: {
      key?: string;
      title?: string;
      languages?: { key?: string }[];
      isbn_10?: string[];
      isbn_13?: string[];
      publish_date?: string;
      publishers?: string[];
    }[];
  }>(`/works/${encodeURIComponent(item.externalId)}/editions.json`, {
    params: { limit: 50 },
  });
  const editions = (response.data.entries ?? []).flatMap((edition) => {
    const id = edition.key?.replace('/books/', '');
    if (!id || !/^OL\d+M$/i.test(id)) return [];
    return [
      {
        id: id.toUpperCase(),
        title: canonicalText(edition.title, 500) ?? item.title,
        languages: (edition.languages ?? []).flatMap((language) => {
          const code = language.key?.split('/').pop();
          return code ? [code] : [];
        }),
        isbn: [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].slice(
          0,
          10
        ),
        publishDate: canonicalText(edition.publish_date, 100),
        publishers: (edition.publishers ?? []).slice(0, 10),
      },
    ];
  });
  return { ...item, related: [], editions };
};
