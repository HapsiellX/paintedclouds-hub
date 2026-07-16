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
import { getSettings } from '@server/lib/settings';
import axios from 'axios';

const requiredNumber = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} ist nicht gültig konfiguriert`);
  }
  return value;
};

const submitArtist = async (request: HubRequest): Promise<string> => {
  const { url, apiKey } = integrationConfig('lidarr');
  const config = getSettings().hub.lidarr;
  if (!url || !apiKey) throw new Error('Lidarr ist nicht konfiguriert');
  const lidarr = new LidarrAPI({ url: `${url}/api/v1`, apiKey });
  const lookup = await lidarr.lookupArtist(request.externalId);
  const artist: LidarrArtist = {
    ...lookup,
    rootFolderPath: config.rootFolder,
    qualityProfileId: requiredNumber(
      config.qualityProfileId,
      'Lidarr quality profile'
    ),
    metadataProfileId: requiredNumber(
      config.metadataProfileId,
      'Lidarr metadata profile'
    ),
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
  const config = getSettings().hub.lidarr;
  if (!url || !apiKey) throw new Error('Lidarr ist nicht konfiguriert');
  const lidarr = new LidarrAPI({ url: `${url}/api/v1`, apiKey });
  const lookup = (await lidarr.getAlbumByForeignAlbumId(
    request.externalId
  )) as unknown as LidarrAlbumOptions;
  lookup.monitored = true;
  lookup.profileId = requiredNumber(
    config.qualityProfileId,
    'Lidarr quality profile'
  );
  lookup.artist.rootFolderPath = config.rootFolder;
  lookup.artist.qualityProfileId = requiredNumber(
    config.qualityProfileId,
    'Lidarr quality profile'
  );
  lookup.artist.metadataProfileId = requiredNumber(
    config.metadataProfileId,
    'Lidarr metadata profile'
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
    name:
      request.isbn ??
      [request.title, request.subtitle].filter(Boolean).join(' '),
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
