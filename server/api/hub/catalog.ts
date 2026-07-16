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
  languages?: string[];
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
    disambiguation?: string;
    country?: string;
  }[];
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
  }));

const discoverMusicShelf = async ({
  id,
  title,
  description,
  query,
}: Omit<HubCatalogShelf, 'items'> & {
  query: string;
}): Promise<HubCatalogShelf> => {
  const response = await musicBrainz.get<MusicBrainzReleaseResponse>(
    '/release-group',
    { params: { query, fmt: 'json', limit: 18 } }
  );
  return {
    id,
    title,
    description,
    items: mapReleaseGroups(response.data['release-groups'] ?? []),
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
    items: mapOpenLibraryWorks(response.data.works ?? []),
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

const discoverMusicShelves = (locale: string) =>
  settledShelves([
    discoverMusicShelf({
      id: 'metal-rock',
      title: 'Metal & Rock',
      description: translate(
        locale,
        'Druckvolle Alben und moderne Gitarrenmusik',
        'Heavy albums and modern guitar music'
      ),
      query: 'tag:metal AND primarytype:album',
    }),
    discoverMusicShelf({
      id: 'soundtracks',
      title: 'Soundtracks & Scores',
      description: translate(
        locale,
        'Musik aus Film, Serie, Anime und Games',
        'Music from movies, series, anime, and games'
      ),
      query: 'secondarytype:soundtrack',
    }),
    discoverMusicShelf({
      id: 'electronic-ambient',
      title: 'Electronic & Ambient',
      description: translate(
        locale,
        'Elektronische Klangwelten zum Entdecken',
        'Electronic soundscapes to discover'
      ),
      query: '(tag:electronic OR tag:ambient) AND primarytype:album',
    }),
  ]);

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

export const discoverHubMusic = (locale = 'de') =>
  cachedDiscovery(`music:${locale}`, () => discoverMusicShelves(locale));

export const discoverHubBooks = (locale = 'de') =>
  cachedDiscovery(`books:${locale}`, () => discoverBookShelves(locale));

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
