import type {
  LidarrAlbumOptions,
  LidarrArtist,
} from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  HubMediaKind,
  HubRequestFormat,
  HubRequestState,
} from '@server/constants/hub';
import type { HubRequest } from '@server/entity/HubRequest';
import { integrationConfig } from '@server/lib/hub/integrations';
import axios from 'axios';

const requiredNumber = (name: string): number => {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} ist nicht gültig konfiguriert`);
  }
  return value;
};

const submitArtist = async (request: HubRequest): Promise<string> => {
  const { url, apiKey } = integrationConfig('lidarr');
  if (!url || !apiKey) throw new Error('Lidarr ist nicht konfiguriert');
  const lidarr = new LidarrAPI({ url: `${url}/api/v1`, apiKey });
  const lookup = await lidarr.lookupArtist(request.externalId);
  const artist: LidarrArtist = {
    ...lookup,
    rootFolderPath: process.env.HUB_LIDARR_ROOT ?? '/music',
    qualityProfileId: requiredNumber('HUB_LIDARR_QUALITY_PROFILE_ID'),
    metadataProfileId: requiredNumber('HUB_LIDARR_METADATA_PROFILE_ID'),
    monitored: true,
    monitorNewItems: 'all',
    tags: lookup.tags ?? [],
    addOptions: { monitor: 'all', searchForMissingAlbums: true },
  };
  const created = lookup.id ? lookup : await lidarr.addArtist(artist);
  if (created.id) await lidarr.searchArtist(created.id);
  return String(created.id ?? request.externalId);
};

const submitAlbum = async (request: HubRequest): Promise<string> => {
  const { url, apiKey } = integrationConfig('lidarr');
  if (!url || !apiKey) throw new Error('Lidarr ist nicht konfiguriert');
  const lidarr = new LidarrAPI({ url: `${url}/api/v1`, apiKey });
  const lookup = (await lidarr.getAlbumByForeignAlbumId(
    request.externalId
  )) as unknown as LidarrAlbumOptions;
  lookup.monitored = true;
  lookup.profileId = requiredNumber('HUB_LIDARR_QUALITY_PROFILE_ID');
  lookup.artist.rootFolderPath = process.env.HUB_LIDARR_ROOT ?? '/music';
  lookup.artist.qualityProfileId = requiredNumber(
    'HUB_LIDARR_QUALITY_PROFILE_ID'
  );
  lookup.artist.metadataProfileId = requiredNumber(
    'HUB_LIDARR_METADATA_PROFILE_ID'
  );
  lookup.artist.monitored = false;
  lookup.artist.monitorNewItems = 'none';
  lookup.addOptions = { searchForNewAlbum: true };
  const created = await lidarr.addAlbum(lookup);
  return String(created.id);
};

interface LazyLibrarianBook {
  bookid?: string;
  bookId?: string;
  title?: string;
  authorname?: string;
}

const submitBook = async (request: HubRequest): Promise<string> => {
  const { url, apiKey } = integrationConfig('lazylibrarian');
  if (!url || !apiKey) {
    throw new Error('LazyLibrarian ist nicht konfiguriert');
  }
  const call = async (cmd: string, params: Record<string, unknown> = {}) =>
    axios.get(`${url}/api`, {
      timeout: 15_000,
      params: { apikey: apiKey, cmd, ...params },
    });
  const found = await call('findBook', {
    name: [request.title, request.subtitle].filter(Boolean).join(' '),
  });
  const books: LazyLibrarianBook[] = Array.isArray(found.data)
    ? found.data
    : (found.data?.books ?? found.data?.result ?? []);
  const book = books[0];
  const bookId = book?.bookid ?? book?.bookId;
  if (!bookId) throw new Error('LazyLibrarian hat das Buch nicht gefunden');
  await call('addBook', { id: bookId });
  for (const format of request.formats ?? [HubRequestFormat.EBOOK]) {
    await call('searchBook', {
      id: bookId,
      type: format === HubRequestFormat.AUDIOBOOK ? 'AudioBook' : 'eBook',
    });
  }
  return String(bookId);
};

export const submitHubRequest = async (
  request: HubRequest
): Promise<HubRequest> => {
  let targetId: string;
  switch (request.kind) {
    case HubMediaKind.MUSIC_ARTIST:
      request.targetService = 'lidarr';
      targetId = await submitArtist(request);
      break;
    case HubMediaKind.MUSIC_ALBUM:
      request.targetService = 'lidarr';
      targetId = await submitAlbum(request);
      break;
    case HubMediaKind.BOOK:
      request.targetService = 'lazylibrarian';
      targetId = await submitBook(request);
      break;
    default:
      throw new Error(
        'Film- und Serienwünsche werden über Seerrs vorhandenen Request-Endpunkt verarbeitet'
      );
  }
  request.targetId = targetId;
  request.state = HubRequestState.SUBMITTED;
  request.errorMessage = null;
  return request;
};
