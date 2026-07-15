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
