import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { HubMediaKind } from '@server/constants/hub';
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

const musicBrainz = rateLimit(
  axios.create({
    baseURL: 'https://musicbrainz.org/ws/2',
    timeout: 10_000,
    headers: {
      'User-Agent':
        process.env.HUB_METADATA_USER_AGENT ??
        'PaintedCloudsHub/1.0 (https://paintedclouds.com)',
    },
  }),
  { maxRequests: 1, perMilliseconds: 1_000 }
);

const openLibrary = rateLimit(
  axios.create({
    baseURL: 'https://openlibrary.org',
    timeout: 10_000,
    headers: {
      'User-Agent':
        process.env.HUB_METADATA_USER_AGENT ??
        'PaintedCloudsHub/1.0 (https://paintedclouds.com)',
    },
  }),
  { maxRequests: 3, perMilliseconds: 1_000 }
);

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

const discoverMusicShelves = () =>
  settledShelves([
    discoverMusicShelf({
      id: 'metal-rock',
      title: 'Metal & Rock',
      description: 'Druckvolle Alben und moderne Gitarrenmusik',
      query: 'tag:metal AND primarytype:album',
    }),
    discoverMusicShelf({
      id: 'soundtracks',
      title: 'Soundtracks & Scores',
      description: 'Musik aus Film, Serie, Anime und Games',
      query: 'secondarytype:soundtrack',
    }),
    discoverMusicShelf({
      id: 'electronic-ambient',
      title: 'Electronic & Ambient',
      description: 'Elektronische Klangwelten zum Entdecken',
      query: '(tag:electronic OR tag:ambient) AND primarytype:album',
    }),
  ]);

const discoverBookShelves = () =>
  settledShelves([
    discoverBookShelf({
      id: 'trending',
      title: 'Gerade beliebt',
      description: 'Aktuell häufig entdeckte Bücher',
      path: '/trending/daily.json',
    }),
    discoverBookShelf({
      id: 'science-fiction',
      title: 'Science-Fiction',
      description: 'Ferne Welten, Zukunft und große Ideen',
      path: '/subjects/science_fiction.json',
    }),
    discoverBookShelf({
      id: 'fantasy',
      title: 'Fantasy',
      description: 'Magische Welten und epische Abenteuer',
      path: '/subjects/fantasy.json',
    }),
    discoverBookShelf({
      id: 'thrillers',
      title: 'Thriller & Mystery',
      description: 'Spannung, Rätsel und dunkle Geheimnisse',
      path: '/subjects/thriller.json',
    }),
  ]);

type DiscoveryResult = Awaited<ReturnType<typeof settledShelves>>;
const discoveryCache = new Map<
  'music' | 'books',
  { expiresAt: number; value: DiscoveryResult }
>();

const cachedDiscovery = async (
  section: 'music' | 'books',
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

export const discoverHubMusic = () =>
  cachedDiscovery('music', discoverMusicShelves);

export const discoverHubBooks = () =>
  cachedDiscovery('books', discoverBookShelves);

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
