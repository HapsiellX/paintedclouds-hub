import {
  HubCatalogItemNotFoundError,
  discoverHubBooks,
  discoverHubMusic,
  getHubProviderHealth,
  loadHubRecommendationCandidates,
  resolveHubCatalogDetail,
  resolveHubCatalogItem,
  searchHubCatalog,
  searchHubMusicArtists,
} from '@server/api/hub/catalog';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import {
  HubMediaKind,
  HubRequestFormat,
  HubRequestState,
} from '@server/constants/hub';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAcquisitionIssue } from '@server/entity/HubAcquisitionIssue';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { HubUserProfile } from '@server/entity/HubUserProfile';
import { HubUserSignal } from '@server/entity/HubUserSignal';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import downloadTracker from '@server/lib/downloadtracker';
import { submitHubRequest } from '@server/lib/hub/acquisition';
import { collectHubRequestAcquisition } from '@server/lib/hub/acquisitionCollectors';
import {
  findAcquisitionIssues,
  findRecentResolvedAcquisitionIssues,
  recordAcquisitionIssue,
  resolveAcquisitionIssues,
  visibleAcquisitionIssueWhere,
} from '@server/lib/hub/acquisitionIssues';
import {
  acquisitionIssueDto,
  canonicalEpisodePartKey,
  summarizeHubAcquisition,
  type HubAcquisition,
} from '@server/lib/hub/acquisitionStatus';
import { withHubMetadataCache } from '@server/lib/hub/cache';
import { summarizeHubDownloads } from '@server/lib/hub/downloadProgress';
import {
  HUB_SUBMISSION_FAILED_MESSAGE,
  toHubRequestDto,
} from '@server/lib/hub/dto';
import {
  getHubServiceStatus,
  getStorageUsage,
} from '@server/lib/hub/integrations';
import { notifyHomeAssistant } from '@server/lib/hub/notifications';
import {
  configuredHubRequestPoints,
  consumeHubQuota,
  getHubQuotaStatus,
  releaseHubQuota,
  reserveHubQuota,
} from '@server/lib/hub/quota';
import {
  hubCatalogLimiter,
  hubCreateLimiter,
  hubManagementLimiter,
  hubReadLimiter,
} from '@server/lib/hub/rateLimit';
import {
  diversifyHubRecommendations,
  hubItemKey,
  rankHubRecommendations,
} from '@server/lib/hub/recommendations';
import {
  getHubReconciliationStatus,
  reconcileHubRequests,
} from '@server/lib/hub/reconciliation';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { In, IsNull } from 'typeorm';
import { z } from 'zod';

const hubRoutes = Router();

const trustedImageHosts = new Map([
  ['tmdb', new Set(['image.tmdb.org'])],
  ['musicbrainz', new Set(['coverartarchive.org'])],
  ['openlibrary', new Set(['covers.openlibrary.org'])],
]);

const requestSchema = z
  .object({
    kind: z.enum([
      HubMediaKind.MUSIC_ARTIST,
      HubMediaKind.MUSIC_ALBUM,
      HubMediaKind.BOOK,
    ]),
    provider: z.enum(['musicbrainz', 'openlibrary']),
    externalId: z.string().trim().min(1).max(128),
    editionId: z
      .string()
      .trim()
      .regex(/^OL\d+M$/i)
      .optional(),
    title: z.string().trim().min(1).max(500),
    subtitle: z.string().trim().max(500).optional(),
    imageUrl: z.string().url().max(2_000).optional(),
    formats: z
      .array(z.enum([HubRequestFormat.EBOOK, HubRequestFormat.AUDIOBOOK]))
      .max(2)
      .optional(),
    languages: z
      .array(
        z
          .string()
          .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
          .max(8)
      )
      .max(5)
      .optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const musicKind =
      body.kind === HubMediaKind.MUSIC_ARTIST ||
      body.kind === HubMediaKind.MUSIC_ALBUM;
    if (
      (musicKind && body.provider !== 'musicbrainz') ||
      (body.kind === HubMediaKind.BOOK && body.provider !== 'openlibrary')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Provider und Medientyp passen nicht zusammen.',
      });
    }
    if (musicKind && !z.uuid().safeParse(body.externalId).success) {
      context.addIssue({
        code: 'custom',
        path: ['externalId'],
        message: 'Ungültige MusicBrainz-ID.',
      });
    }
    if (body.kind === HubMediaKind.BOOK && !/^OL\d+W$/i.test(body.externalId)) {
      context.addIssue({
        code: 'custom',
        path: ['externalId'],
        message: 'Ungültige Open-Library-ID.',
      });
    }
    if (body.imageUrl) {
      const imageHost = new URL(body.imageUrl).hostname.toLowerCase();
      if (!trustedImageHosts.get(body.provider)?.has(imageHost)) {
        context.addIssue({
          code: 'custom',
          path: ['imageUrl'],
          message: 'Nicht vertrauenswürdige Bildquelle.',
        });
      }
    }
  });

const listSchema = z.object({
  take: z.coerce.number().int().min(1).max(250).default(100),
  skip: z.coerce.number().int().min(0).default(0),
  kinds: z.string().max(200).optional(),
  formats: z.string().max(100).optional(),
  states: z.string().max(300).optional(),
  query: z.string().trim().max(200).optional(),
  scanCursor: z.coerce.number().int().min(0).default(0),
});

const idSchema = z.coerce.number().int().positive();
const declineSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

const profileSchema = z
  .object({
    enabled: z.boolean().optional(),
    preferredMediaKinds: z.array(z.enum(HubMediaKind)).max(5).optional(),
    preferredGenres: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .optional(),
    preferredLanguages: z
      .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/))
      .max(10)
      .optional(),
    musicGenres: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    musicArtists: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(200),
            type: z.string().trim().max(80).optional(),
          })
          .strict()
      )
      .max(20)
      .optional(),
  })
  .strict();

const signalSchema = z
  .object({
    kind: z.enum(HubMediaKind),
    provider: z.enum(['tmdb', 'musicbrainz', 'openlibrary']),
    externalId: z.string().trim().min(1).max(128),
    liked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    saved: z.boolean().optional(),
    title: z.string().trim().max(500).optional(),
    subtitle: z.string().trim().max(500).optional(),
    imageUrl: z.string().url().max(2_000).optional(),
    genres: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    languages: z.array(z.string().trim().min(2).max(8)).max(10).optional(),
    formats: z.array(z.enum(HubRequestFormat)).max(2).optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const valid =
      (body.provider === 'tmdb' &&
        [HubMediaKind.MOVIE, HubMediaKind.TV].includes(body.kind) &&
        /^\d+$/.test(body.externalId)) ||
      (body.provider === 'musicbrainz' &&
        [HubMediaKind.MUSIC_ARTIST, HubMediaKind.MUSIC_ALBUM].includes(
          body.kind
        ) &&
        z.uuid().safeParse(body.externalId).success) ||
      (body.provider === 'openlibrary' &&
        body.kind === HubMediaKind.BOOK &&
        /^OL\d+W$/i.test(body.externalId));
    if (!valid)
      context.addIssue({
        code: 'custom',
        path: ['externalId'],
        message: 'Provider, Medientyp und ID passen nicht zusammen.',
      });
  });

const recommendationQuerySchema = z.object({
  mediaType: z.enum(['all', ...Object.values(HubMediaKind)]).default('all'),
  cursor: z.string().max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

const normalizeList = (values: string[] | undefined) =>
  values
    ? [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    : undefined;

const toProfileDto = (profile: HubUserProfile) => ({
  enabled: profile.enabled,
  preferredMediaKinds: profile.preferredMediaKinds ?? [],
  preferredGenres: profile.preferredGenres ?? [],
  preferredLanguages: profile.preferredLanguages ?? [],
  musicGenres: profile.musicGenres ?? [],
  musicArtists: profile.musicArtists ?? [],
});

const getOrCreateProfile = async (user: User) => {
  const repository = getRepository(HubUserProfile);
  const existing = await repository.findOne({
    where: { user: { id: user.id } },
  });
  return (
    existing ??
    repository.save(
      repository.create({
        user,
        enabled: true,
        preferredMediaKinds: [],
        preferredGenres: [],
        preferredLanguages: [user.settings?.locale?.slice(0, 2) ?? 'de'],
        musicGenres: [],
        musicArtists: [],
      })
    )
  );
};

const decodeCursor = (cursor?: string) => {
  if (!cursor) return 0;
  try {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(value) && value >= 0 ? value : -1;
  } catch {
    return -1;
  }
};

const encodeCursor = (offset: number) =>
  Buffer.from(String(offset), 'utf8').toString('base64url');

const toSignalCatalogItem = (signal: HubUserSignal) => ({
  kind: signal.kind,
  provider: signal.provider,
  externalId: signal.externalId,
  title: signal.title ?? 'Gespeicherter Titel',
  subtitle: signal.subtitle ?? undefined,
  imageUrl: signal.imageUrl ?? undefined,
  genres: signal.genres ?? undefined,
  languages: signal.languages ?? undefined,
  formats: signal.formats ?? undefined,
  liked: signal.liked,
  saved: signal.saved,
  hidden: signal.hidden,
});

const providerUnavailableMessage =
  'Ein Metadatenanbieter ist vorübergehend nicht erreichbar.';
const requestFailedMessage = 'Die Hub-Anfrage konnte nicht verarbeitet werden.';
const duplicateResponse = {
  code: 'HUB_REQUEST_EXISTS',
  message: 'Dieser Titel wurde bereits gewünscht.',
} as const;
const sanitizeCatalogResult = <T extends { errors: string[] }>(result: T): T =>
  ({
    ...result,
    errors: result.errors.length ? [providerUnavailableMessage] : [],
  }) as T;

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
};

const addAudit = async (
  request: HubRequest,
  action: string,
  actor?: User,
  details?: Record<string, unknown>
) => {
  await getRepository(HubAuditEvent).save({ request, action, actor, details });
};

hubRoutes.get('/search', hubCatalogLimiter, async (req, res) => {
  const query = String(req.query.query ?? '').trim();
  if (query.length < 2 || query.length > 200) {
    return res.status(400).json({
      message: 'Die Suche muss zwischen 2 und 200 Zeichen lang sein.',
    });
  }
  const allKinds = Object.values(HubMediaKind);
  const requestedKinds = String(req.query.kinds ?? '')
    .split(',')
    .filter((kind): kind is HubMediaKind =>
      allKinds.includes(kind as HubMediaKind)
    );
  try {
    const language = String(req.query.language ?? req.locale ?? 'de-DE');
    const selectedKinds = requestedKinds.length ? requestedKinds : allKinds;
    const cacheKey = createHash('sha256')
      .update(
        `${query.toLowerCase()}:${selectedKinds.sort().join(',')}:${language}`
      )
      .digest('hex');
    const results = await withHubMetadataCache(
      'catalog',
      `search:${cacheKey}`,
      () => searchHubCatalog({ query, kinds: selectedKinds, language }),
      6 * 60 * 60 * 1000
    );
    return res.json(sanitizeCatalogResult(results));
  } catch {
    return res.status(502).json({ message: providerUnavailableMessage });
  }
});

hubRoutes.get('/discover/:section', hubCatalogLimiter, async (req, res) => {
  try {
    const locale = String(req.locale ?? 'de');
    if (req.params.section === 'music') {
      const profile = await getOrCreateProfile(req.user as User);
      return res.json(
        sanitizeCatalogResult(
          await discoverHubMusic({
            genres: profile.musicGenres ?? [],
            artists: profile.musicArtists ?? [],
            locale,
          })
        )
      );
    }
    if (req.params.section === 'books')
      return res.json(
        sanitizeCatalogResult(
          await withHubMetadataCache(
            'openlibrary',
            `discover:books:v2:${locale}`,
            () => discoverHubBooks(locale),
            6 * 60 * 60 * 1000
          )
        )
      );
    return res.status(404).json({ message: 'Unbekannter Medienbereich.' });
  } catch {
    return res.status(502).json({ message: providerUnavailableMessage });
  }
});

hubRoutes.get(
  '/items/:kind/:provider/:externalId',
  hubCatalogLimiter,
  async (req, res) => {
    const identity = z
      .object({
        kind: z.enum([
          HubMediaKind.MUSIC_ARTIST,
          HubMediaKind.MUSIC_ALBUM,
          HubMediaKind.BOOK,
        ]),
        provider: z.enum(['musicbrainz', 'openlibrary']),
        externalId: z.string().min(1).max(128),
      })
      .safeParse(req.params);
    if (!identity.success)
      return res.status(400).json({ message: 'Ungültiger Katalogeintrag.' });
    try {
      const detail = await withHubMetadataCache(
        identity.data.provider,
        `detail:${identity.data.kind}:${identity.data.externalId.toLowerCase()}`,
        () => resolveHubCatalogDetail(identity.data)
      );
      return res.json(detail);
    } catch (error) {
      if (error instanceof HubCatalogItemNotFoundError)
        return res.sendStatus(404);
      return res.status(502).json({ message: providerUnavailableMessage });
    }
  }
);

hubRoutes.get(
  '/personalization/music/artists',
  hubCatalogLimiter,
  async (req, res) => {
    const query = String(req.query.query ?? '').trim();
    if (query.length < 2 || query.length > 100)
      return res.status(400).json({
        message: 'Die Künstlersuche muss zwischen 2 und 100 Zeichen lang sein.',
      });
    try {
      return res.json({ results: await searchHubMusicArtists(query) });
    } catch {
      return res.status(502).json({ message: providerUnavailableMessage });
    }
  }
);

hubRoutes.get('/personalization/profile', hubReadLimiter, async (req, res) => {
  const profile = await getOrCreateProfile(req.user as User);
  return res.json(toProfileDto(profile));
});

hubRoutes.put(
  '/personalization/profile',
  hubManagementLimiter,
  async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: 'Ungültige Personalisierungseinstellungen.' });
    const user = req.user as User;
    const profile = await getOrCreateProfile(user);
    if (parsed.data.enabled !== undefined)
      profile.enabled = parsed.data.enabled;
    if (parsed.data.preferredMediaKinds)
      profile.preferredMediaKinds = [
        ...new Set(parsed.data.preferredMediaKinds),
      ];
    if (parsed.data.preferredGenres)
      profile.preferredGenres = normalizeList(parsed.data.preferredGenres);
    if (parsed.data.preferredLanguages)
      profile.preferredLanguages = normalizeList(
        parsed.data.preferredLanguages
      );
    if (parsed.data.musicGenres)
      profile.musicGenres = normalizeList(parsed.data.musicGenres);
    if (parsed.data.musicArtists)
      profile.musicArtists = parsed.data.musicArtists.filter(
        (artist, index, artists) =>
          artists.findIndex((other) => other.id === artist.id) === index
      );
    const saved = await getRepository(HubUserProfile).save(profile);
    return res.json(toProfileDto(saved));
  }
);

hubRoutes.put(
  '/personalization/items',
  hubManagementLimiter,
  async (req, res) => {
    const parsed = signalSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: 'Ungültiges Feedback.', issues: parsed.error.issues });
    const user = req.user as User;
    const body = parsed.data;
    if (body.imageUrl) {
      const hostname = new URL(body.imageUrl).hostname.toLowerCase();
      if (!trustedImageHosts.get(body.provider)?.has(hostname))
        return res
          .status(400)
          .json({ message: 'Nicht vertrauenswürdige Bildquelle.' });
    }
    const externalId =
      body.provider === 'openlibrary'
        ? body.externalId.toUpperCase()
        : body.provider === 'musicbrainz'
          ? body.externalId.toLowerCase()
          : String(Number(body.externalId));
    const repository = getRepository(HubUserSignal);
    let signal = await repository.findOne({
      where: {
        user: { id: user.id },
        provider: body.provider,
        externalId,
        kind: body.kind,
      },
    });
    signal ??= repository.create({
      user,
      provider: body.provider,
      externalId,
      kind: body.kind,
      liked: false,
      hidden: false,
      saved: false,
    });
    for (const state of ['liked', 'hidden', 'saved'] as const) {
      const value = body[state];
      if (value !== undefined) signal[state] = value;
    }
    signal.title = body.title ?? signal.title;
    signal.subtitle = body.subtitle ?? signal.subtitle;
    signal.imageUrl = body.imageUrl ?? signal.imageUrl;
    signal.genres = normalizeList(body.genres) ?? signal.genres;
    signal.languages = normalizeList(body.languages) ?? signal.languages;
    signal.formats = body.formats ? [...new Set(body.formats)] : signal.formats;
    if (!signal.liked && !signal.hidden && !signal.saved) {
      if (signal.id) await repository.remove(signal);
      return res.json({
        ...toSignalCatalogItem(signal),
        liked: false,
        hidden: false,
        saved: false,
      });
    }
    return res.json(toSignalCatalogItem(await repository.save(signal)));
  }
);

hubRoutes.delete(
  '/personalization/data',
  hubManagementLimiter,
  async (req, res) => {
    const user = req.user as User;
    await getRepository(HubUserSignal).delete({ user: { id: user.id } });
    const profileRepository = getRepository(HubUserProfile);
    await profileRepository.delete({ user: { id: user.id } });
    const profile = await profileRepository.save(
      profileRepository.create({
        user,
        enabled: false,
        preferredMediaKinds: [],
        preferredGenres: [],
        preferredLanguages: [],
        musicGenres: [],
        musicArtists: [],
      })
    );
    return res.json(toProfileDto(profile));
  }
);

hubRoutes.get('/saved', hubReadLimiter, async (req, res) => {
  const parsed = recommendationQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: 'Ungültige Seiteneinstellungen.' });
  const offset = decodeCursor(parsed.data.cursor);
  if (offset < 0)
    return res.status(400).json({ message: 'Ungültiger Cursor.' });
  const signals = await getRepository(HubUserSignal).find({
    where: { user: { id: (req.user as User).id }, saved: true },
    order: { updatedAt: 'DESC', id: 'DESC' },
    skip: offset,
    take: parsed.data.pageSize + 1,
  });
  const hasMore = signals.length > parsed.data.pageSize;
  return res.json({
    results: signals.slice(0, parsed.data.pageSize).map(toSignalCatalogItem),
    nextCursor: hasMore ? encodeCursor(offset + parsed.data.pageSize) : null,
  });
});

hubRoutes.get('/recommendations', hubCatalogLimiter, async (req, res) => {
  const parsed = recommendationQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: 'Ungültige Seiteneinstellungen.' });
  const offset = decodeCursor(parsed.data.cursor);
  if (offset < 0)
    return res.status(400).json({ message: 'Ungültiger Cursor.' });
  const user = req.user as User;
  const profile = await getOrCreateProfile(user);
  if (!profile.enabled)
    return res.json({
      enabled: false,
      shelves: [],
      results: [],
      nextCursor: null,
      errors: [],
    });

  const [signals, hubRequests, videoRequests, media] = await Promise.all([
    getRepository(HubUserSignal).find({ where: { user: { id: user.id } } }),
    getRepository(HubRequest).find({
      where: { requestedBy: { id: user.id } },
    }),
    getRepository(MediaRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.media', 'media')
      .where('request.requestedById = :userId', { userId: user.id })
      .getMany(),
    getRepository(Media).find(),
  ]);
  const librarySeeds: {
    kind: HubMediaKind.MOVIE | HubMediaKind.TV;
    id: number;
  }[] = [];
  for (const kind of [HubMediaKind.MOVIE, HubMediaKind.TV] as const) {
    const item = media.find(
      (candidate) =>
        candidate.mediaType ===
          (kind === HubMediaKind.MOVIE ? 'movie' : 'tv') &&
        [MediaStatus.PARTIALLY_AVAILABLE, MediaStatus.AVAILABLE].includes(
          candidate.status
        )
    );
    if (item) librarySeeds.push({ kind, id: item.tmdbId });
  }
  const candidateResult = await loadHubRecommendationCandidates(
    req.locale ?? 'de-DE',
    librarySeeds,
    {
      genres: profile.musicGenres ?? [],
      artists: profile.musicArtists ?? [],
    },
    user.settings?.streamingRegion && user.settings.streamingRegion !== 'all'
      ? user.settings.streamingRegion
      : getSettings().main.discoverRegion || 'US'
  );
  const requestedKeys = new Set([
    ...hubRequests.map((request) =>
      hubItemKey({
        provider: request.provider,
        externalId: request.externalId,
        kind: request.kind,
      })
    ),
    ...videoRequests.map((request) =>
      hubItemKey({
        provider: 'tmdb',
        externalId: String(request.media.tmdbId),
        kind:
          request.media.mediaType === 'movie'
            ? HubMediaKind.MOVIE
            : HubMediaKind.TV,
      })
    ),
  ]);
  const availableKeys = new Set([
    ...hubRequests
      .filter((request) => request.state === HubRequestState.AVAILABLE)
      .map((request) =>
        hubItemKey({
          provider: request.provider,
          externalId: request.externalId,
          kind: request.kind,
        })
      ),
    ...media
      .filter((item) =>
        [MediaStatus.PARTIALLY_AVAILABLE, MediaStatus.AVAILABLE].includes(
          item.status
        )
      )
      .map((item) =>
        hubItemKey({
          provider: 'tmdb',
          externalId: String(item.tmdbId),
          kind:
            item.mediaType === 'movie' ? HubMediaKind.MOVIE : HubMediaKind.TV,
        })
      ),
  ]);
  const downloadingKeys = new Set([
    ...hubRequests
      .filter((request) => request.state === HubRequestState.DOWNLOADING)
      .map((request) =>
        hubItemKey({
          provider: request.provider,
          externalId: request.externalId,
          kind: request.kind,
        })
      ),
    ...media
      .filter((item) => item.status === MediaStatus.PROCESSING)
      .map((item) =>
        hubItemKey({
          provider: 'tmdb',
          externalId: String(item.tmdbId),
          kind:
            item.mediaType === 'movie' ? HubMediaKind.MOVIE : HubMediaKind.TV,
        })
      ),
  ]);
  const requestedGenres = candidateResult.items
    .filter((item) => requestedKeys.has(hubItemKey(item)))
    .flatMap((item) => item.genres ?? []);
  const libraryGenres = candidateResult.items
    .filter((item) => availableKeys.has(hubItemKey(item)))
    .flatMap((item) => item.genres ?? []);
  let ranked = rankHubRecommendations(candidateResult.items, {
    preferredKinds: profile.preferredMediaKinds ?? [],
    preferredGenres: profile.preferredGenres ?? [],
    preferredLanguages: profile.preferredLanguages ?? [],
    signals,
    requestedKeys,
    availableKeys,
    requestedGenres,
    libraryGenres,
  }).map((item) => ({
    ...item,
    downloading: downloadingKeys.has(hubItemKey(item)),
  }));
  if (parsed.data.mediaType !== 'all')
    ranked = ranked.filter((item) => item.kind === parsed.data.mediaType);
  const discovery = ranked.filter((item) => !item.available);
  const page = discovery.slice(offset, offset + parsed.data.pageSize);
  const nextOffset = offset + page.length;
  const shelves = [
    {
      id: 'mixed',
      reasonCode: 'MIXED_FOR_YOU',
      items: diversifyHubRecommendations(page, page.length),
    },
    {
      id: 'movies',
      reasonCode: 'MEDIA_MOVIES',
      items: ranked
        .filter((item) => item.kind === HubMediaKind.MOVIE && !item.available)
        .slice(0, 12),
    },
    {
      id: 'series',
      reasonCode: 'MEDIA_SERIES',
      items: ranked
        .filter((item) => item.kind === HubMediaKind.TV && !item.available)
        .slice(0, 12),
    },
    {
      id: 'music',
      reasonCode: 'MEDIA_MUSIC',
      items: ranked
        .filter((item) =>
          [HubMediaKind.MUSIC_ARTIST, HubMediaKind.MUSIC_ALBUM].includes(
            item.kind
          )
        )
        .slice(0, 12),
    },
    {
      id: 'books',
      reasonCode: 'MEDIA_BOOKS',
      items: ranked
        .filter((item) => item.kind === HubMediaKind.BOOK)
        .slice(0, 12),
    },
    {
      id: 'audiobooks',
      reasonCode: 'MEDIA_AUDIOBOOKS',
      items: ranked
        .filter(
          (item) =>
            item.kind === HubMediaKind.BOOK &&
            item.formats?.includes('audiobook')
        )
        .slice(12, 24),
    },
    {
      id: 'rediscover',
      reasonCode: 'REDISCOVER',
      items: ranked.filter((item) => item.available).slice(0, 12),
    },
  ].filter((shelf) => shelf.items.length);
  return res.json({
    enabled: true,
    shelves,
    results: page,
    nextCursor: nextOffset < discovery.length ? encodeCursor(nextOffset) : null,
    errors: candidateResult.errors,
  });
});
hubRoutes.get('/overview', hubReadLimiter, async (req, res) => {
  const user = req.user as User;
  const admin = user.hasPermission(Permission.ADMIN);
  const [services, storage, requests] = await Promise.all([
    getHubServiceStatus(),
    getStorageUsage(),
    getRepository(HubRequest).find({
      where: admin ? {} : { requestedBy: { id: user.id } },
      order: { createdAt: 'DESC' },
      take: 8,
    }),
  ]);
  return res.json({
    services: services.map(({ id, name, healthy, version, queueSize }) => ({
      id,
      name,
      healthy,
      ...(admin ? { version, queueSize } : {}),
    })),
    storage: admin ? storage : { usedPercent: storage.usedPercent },
    requests: requests.map((item) => toHubRequestDto(item, { admin })),
  });
});

hubRoutes.get('/quota', hubReadLimiter, async (req, res) => {
  return res.json(await getHubQuotaStatus(req.user as User));
});

hubRoutes.get('/preferences', hubReadLimiter, (_req, res) => {
  return res.json(getSettings().hub.defaults);
});

hubRoutes.get('/reconciliation', hubManagementLimiter, (req, res) => {
  if (!(req.user as User).hasPermission(Permission.ADMIN))
    return res.sendStatus(403);
  return res.json(getHubReconciliationStatus());
});

hubRoutes.post('/reconciliation', hubManagementLimiter, async (req, res) => {
  if (!(req.user as User).hasPermission(Permission.ADMIN))
    return res.sendStatus(403);
  const id = req.body?.requestId
    ? idSchema.safeParse(req.body.requestId)
    : { success: true as const, data: undefined };
  if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
  return res.json(await reconcileHubRequests(id.data));
});

hubRoutes.get('/providers/status', hubReadLimiter, async (req, res) => {
  const user = req.user as User;
  if (!user.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  return res.json({ providers: getHubProviderHealth() });
});

hubRoutes.get('/requests', hubReadLimiter, async (req, res) => {
  const user = req.user as User;
  const admin = user.hasPermission(Permission.ADMIN);
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Ungültige Seitengröße.' });
  }
  const requests = await getRepository(HubRequest).find({
    where: admin ? {} : { requestedBy: { id: user.id } },
    order: { createdAt: 'DESC' },
    take: parsed.data.take,
    skip: parsed.data.skip,
  });
  return res.json({
    results: requests.map((item) => toHubRequestDto(item, { admin })),
  });
});

hubRoutes.get('/requests/:id/history', hubReadLimiter, async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
  const user = req.user as User;
  const admin = user.hasPermission(Permission.ADMIN);
  const canViewAll = user.hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const hubRequest = await getRepository(HubRequest).findOne({
    where:
      admin || canViewAll
        ? { id: id.data }
        : { id: id.data, requestedBy: { id: user.id } },
  });
  if (!hubRequest) return res.sendStatus(404);
  const events = await getRepository(HubAuditEvent).find({
    where: { request: { id: hubRequest.id } },
    relations: { actor: true },
    order: { createdAt: 'ASC' },
  });
  return res.json({
    results: events.map((event) => ({
      id: event.id,
      action: event.action,
      createdAt: event.createdAt,
      ...(admin && event.actor
        ? {
            actor: {
              id: event.actor.id,
              displayName: event.actor.displayName,
              avatar: event.actor.avatar,
            },
          }
        : {}),
      ...(event.action === 'state_changed'
        ? {
            from: event.details?.from,
            to: event.details?.to,
          }
        : {}),
    })),
  });
});

hubRoutes.get('/activity', hubReadLimiter, async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: 'Ungültige Seitengröße.' });
  const user = req.user as User;
  const admin = user.hasPermission(Permission.ADMIN);
  const canViewAll = user.hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const take = Math.min(parsed.data.take, 100);
  const requestedKinds = new Set(
    parsed.data.kinds
      ?.split(',')
      .filter((kind) =>
        Object.values(HubMediaKind).includes(kind as HubMediaKind)
      ) ?? []
  );
  const requestedStates = new Set(
    parsed.data.states
      ?.split(',')
      .filter((state) =>
        Object.values(HubRequestState).includes(state as HubRequestState)
      ) ?? []
  );
  const requestedFormats = new Set(
    parsed.data.formats
      ?.split(',')
      .filter((format) =>
        Object.values(HubRequestFormat).includes(format as HubRequestFormat)
      ) ?? []
  );
  const activityQuery = parsed.data.query?.toLocaleLowerCase();
  const sourceLimit = parsed.data.skip + take * 2;
  const filteredActivity = Boolean(
    requestedKinds.size ||
    requestedStates.size ||
    requestedFormats.size ||
    activityQuery
  );
  const pageScanLimit = filteredActivity
    ? Math.min(500, sourceLimit + take * 5)
    : sourceLimit;
  const [
    pageHubRequests,
    pageVideoRequests,
    activeHubRequests,
    activeVideoRequests,
  ] = await Promise.all([
    getRepository(HubRequest).find({
      where: canViewAll ? {} : { requestedBy: { id: user.id } },
      order: { createdAt: 'DESC' },
      take: pageScanLimit,
      ...(filteredActivity && parsed.data.scanCursor
        ? { skip: parsed.data.scanCursor }
        : {}),
    }),
    getRepository(MediaRequest).find({
      where: canViewAll ? {} : { requestedBy: { id: user.id } },
      order: { createdAt: 'DESC' },
      take: pageScanLimit,
      ...(filteredActivity && parsed.data.scanCursor
        ? { skip: parsed.data.scanCursor }
        : {}),
    }),
    getRepository(HubRequest).find({
      where: {
        ...(canViewAll ? {} : { requestedBy: { id: user.id } }),
        state: In([
          HubRequestState.SUBMITTED,
          HubRequestState.DOWNLOADING,
          HubRequestState.IMPORTED,
          HubRequestState.FAILED,
        ]),
      },
    }),
    getRepository(MediaRequest).find({
      where: {
        ...(canViewAll ? {} : { requestedBy: { id: user.id } }),
        status: In([MediaRequestStatus.APPROVED, MediaRequestStatus.FAILED]),
      },
    }),
  ]);
  let hubRequests = [
    ...new Map(
      [...pageHubRequests, ...activeHubRequests].map((request) => [
        request.id,
        request,
      ])
    ).values(),
  ];
  let videoRequests = [
    ...new Map(
      [...pageVideoRequests, ...activeVideoRequests].map((request) => [
        request.id,
        request,
      ])
    ).values(),
  ];
  const [issues, recentResolvedIssues] = await Promise.all([
    findAcquisitionIssues(user),
    findRecentResolvedAcquisitionIssues(user),
  ]);
  const allIssueRequests = [...issues, ...recentResolvedIssues];
  const missingHubIds = allIssueRequests
    .filter(
      (issue) =>
        issue.requestSource === 'hub' &&
        !hubRequests.some((request) => request.id === issue.requestId)
    )
    .map((issue) => issue.requestId);
  const missingVideoIds = allIssueRequests
    .filter(
      (issue) =>
        issue.requestSource === 'seerr' &&
        !videoRequests.some((request) => request.id === issue.requestId)
    )
    .map((issue) => issue.requestId);
  const [issueHubRequests, issueVideoRequests] = await Promise.all([
    missingHubIds.length
      ? getRepository(HubRequest).findBy({ id: In(missingHubIds) })
      : [],
    missingVideoIds.length
      ? getRepository(MediaRequest).findBy({ id: In(missingVideoIds) })
      : [],
  ]);
  hubRequests = [...hubRequests, ...issueHubRequests];
  videoRequests = [...videoRequests, ...issueVideoRequests];
  const pageItemIds = new Set([
    ...pageHubRequests.map((request) => `hub:${request.id}`),
    ...pageVideoRequests.map((request) => `video:${request.id}`),
  ]);
  const issuesByRequest = new Map<string, HubAcquisitionIssue[]>();
  issues.forEach((issue) => {
    const key = `${issue.requestSource}:${issue.requestId}:${issue.is4k}`;
    issuesByRequest.set(key, [...(issuesByRequest.get(key) ?? []), issue]);
  });
  const trackerStatus = downloadTracker.getStatus();
  const tmdb = new TheMovieDb();
  const video = await mapWithConcurrency(videoRequests, 8, async (request) => {
    const detail = await (
      request.type === MediaType.MOVIE
        ? tmdb.getMovie({
            movieId: request.media.tmdbId,
            language: req.locale,
          })
        : tmdb.getTvShow({ tvId: request.media.tmdbId, language: req.locale })
    ).catch(() => undefined);
    const requestedSeasons = new Set(
      request.seasons.map((season) => season.seasonNumber)
    );
    const rawDownloads =
      request.media[request.is4k ? 'downloadStatus4k' : 'downloadStatus'] ?? [];
    const requestDownloads =
      request.type === MediaType.TV
        ? rawDownloads.filter(
            (item) =>
              item.episode && requestedSeasons.has(item.episode.seasonNumber)
          )
        : rawDownloads;
    const downloadProgress = summarizeHubDownloads(requestDownloads);
    const mediaStatus = request.media[request.is4k ? 'status4k' : 'status'];
    const serviceId = request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
    const externalServiceId =
      request.media[request.is4k ? 'externalServiceId4k' : 'externalServiceId'];
    const fullVideoSnapshot =
      serviceId != null && externalServiceId != null
        ? downloadTracker.getVideoSnapshot(
            request.type,
            serviceId,
            externalServiceId
          )
        : undefined;
    const trackerProvider =
      request.type === MediaType.MOVIE
        ? ('radarr' as const)
        : ('sonarr' as const);
    const relevantTrackerStale = trackerStatus.serverStale
      ? (trackerStatus.serverStale[trackerProvider]?.[serviceId ?? -1] ?? true)
      : trackerStatus.providerStale
        ? trackerStatus.providerStale[trackerProvider]
        : trackerStatus.stale || !trackerStatus.providers[trackerProvider];
    const relevantLastSuccessfulSyncAt =
      trackerStatus.serverLastSuccessfulSyncAt?.[trackerProvider]?.[
        serviceId ?? -1
      ] ??
      trackerStatus.providerLastSuccessfulSyncAt?.[trackerProvider] ??
      trackerStatus.lastSuccessfulSyncAt;
    const videoSnapshot =
      request.type === MediaType.TV && fullVideoSnapshot?.seasons
        ? (() => {
            const selected = [...requestedSeasons]
              .map((seasonNumber) => fullVideoSnapshot.seasons?.[seasonNumber])
              .filter(
                (
                  season
                ): season is {
                  requested: number;
                  imported: number;
                  queued: number;
                  failed: number;
                } => Boolean(season)
              );
            const requested = selected.reduce(
              (sum, season) => sum + season.requested,
              0
            );
            const imported = selected.reduce(
              (sum, season) => sum + season.imported,
              0
            );
            return {
              availability:
                requested > 0 && imported >= requested
                  ? ('imported' as const)
                  : imported > 0
                    ? ('partial' as const)
                    : ('missing' as const),
              waitingForRelease: false,
              requested,
              imported,
              queued: selected.reduce((sum, season) => sum + season.queued, 0),
              failed: selected.reduce((sum, season) => sum + season.failed, 0),
            };
          })()
        : fullVideoSnapshot;
    const linkedTrackerUnavailable = Boolean(
      serviceId != null &&
      externalServiceId != null &&
      relevantTrackerStale &&
      !fullVideoSnapshot &&
      requestDownloads.length === 0
    );
    const availability =
      mediaStatus === MediaStatus.AVAILABLE
        ? ('available' as const)
        : mediaStatus === MediaStatus.PARTIALLY_AVAILABLE
          ? ('partial' as const)
          : request.status === MediaRequestStatus.COMPLETED
            ? ('imported' as const)
            : (videoSnapshot?.availability ?? ('missing' as const));
    const releaseDate =
      detail && 'release_date' in detail ? detail.release_date : undefined;
    const waitingForRelease =
      videoSnapshot?.waitingForRelease ??
      (request.type === MediaType.MOVIE &&
        Boolean(releaseDate && new Date(releaseDate).getTime() > Date.now()));
    const issueKey = `seerr:${request.id}:${request.is4k}`;
    let issue = issuesByRequest.get(issueKey)?.[0];
    let acquisition = summarizeHubAcquisition({
      downloads: requestDownloads,
      availability,
      fallbackPhase:
        availability === 'available'
          ? 'available'
          : availability === 'partial'
            ? 'partially_available'
            : availability === 'imported'
              ? 'import_pending'
              : linkedTrackerUnavailable
                ? 'unknown'
                : waitingForRelease
                  ? 'waiting_for_release'
                  : 'searching',
      updatedAt: relevantLastSuccessfulSyncAt
        ? new Date(relevantLastSuccessfulSyncAt)
        : request.updatedAt,
      stale:
        relevantTrackerStale &&
        Boolean(serviceId != null && externalServiceId != null),
      counts: videoSnapshot
        ? {
            requested: videoSnapshot.requested,
            queued: videoSnapshot.queued,
            imported: videoSnapshot.imported,
            failed: videoSnapshot.failed,
          }
        : undefined,
    });
    if (
      (request.status === MediaRequestStatus.FAILED ||
        acquisition.phase === 'failed') &&
      !issue
    ) {
      const failedPart = acquisition.parts.find(
        (part) => part.phase === 'failed'
      );
      const partKeys = failedPart?.episodes.length
        ? failedPart.episodes.map((episode) =>
            canonicalEpisodePartKey(episode.seasonNumber, episode.episodeNumber)
          )
        : [''];
      const recordedIssues = await Promise.all(
        partKeys.map((partKey) =>
          recordAcquisitionIssue({
            requestSource: 'seerr',
            requestId: request.id,
            kind: request.type,
            externalId: String(request.media.tmdbId),
            is4k: request.is4k,
            reasonCode:
              failedPart?.reasonCode ??
              (request.status === MediaRequestStatus.FAILED
                ? 'submission_failed'
                : 'download_failed'),
            partKey,
            requestedBy: request.requestedBy,
          })
        )
      );
      issue = recordedIssues[0];
      issuesByRequest.set(issueKey, [
        ...(issuesByRequest.get(issueKey) ?? []),
        ...recordedIssues,
      ]);
      acquisition = { ...acquisition, issue: acquisitionIssueDto(issue) };
    } else if (
      issue &&
      acquisition.phase !== 'failed' &&
      (availability === 'available' || availability === 'imported')
    ) {
      await resolveAcquisitionIssues('seerr', request.id);
      issuesByRequest.delete(issueKey);
      acquisition = { ...acquisition, issue: undefined };
    } else if (issue) {
      acquisition = {
        ...acquisition,
        phase: 'failed',
        health: 'error',
        issue: acquisitionIssueDto(issue),
      };
    }
    const state =
      request.status === MediaRequestStatus.PENDING
        ? HubRequestState.PENDING
        : request.status === MediaRequestStatus.DECLINED
          ? HubRequestState.DECLINED
          : request.status === MediaRequestStatus.FAILED
            ? HubRequestState.FAILED
            : mediaStatus === MediaStatus.AVAILABLE
              ? HubRequestState.AVAILABLE
              : downloadProgress
                ? HubRequestState.DOWNLOADING
                : request.status === MediaRequestStatus.COMPLETED
                  ? HubRequestState.IMPORTED
                  : HubRequestState.SUBMITTED;
    return {
      id: `video:${request.id}`,
      source: 'seerr' as const,
      sourceId: request.id,
      kind: request.type,
      provider: 'tmdb' as const,
      externalId: String(request.media.tmdbId),
      is4k: request.is4k,
      title:
        detail && 'title' in detail
          ? detail.title
          : detail && 'name' in detail
            ? detail.name
            : `${request.type === MediaType.MOVIE ? 'Film' : 'Serie'} #${request.media.tmdbId}`,
      imageUrl: detail?.poster_path
        ? `https://image.tmdb.org/t/p/w500${detail.poster_path}`
        : undefined,
      state,
      requestedBy: {
        id: request.requestedBy.id,
        displayName: request.requestedBy.displayName,
        avatar: request.requestedBy.avatar,
      },
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      acquisition,
      ...(downloadProgress ? { downloadProgress } : {}),
    };
  });
  const hub = await mapWithConcurrency(hubRequests, 8, async (request) => {
    const issueKey = `hub:${request.id}:false`;
    let issue = issuesByRequest.get(issueKey)?.[0];
    if (request.state === HubRequestState.FAILED && !issue) {
      issue = await recordAcquisitionIssue({
        requestSource: 'hub',
        requestId: request.id,
        kind: request.kind,
        externalId: request.externalId,
        is4k: false,
        reasonCode: 'submission_failed',
        requestedBy: request.requestedBy,
      });
      issuesByRequest.set(issueKey, [
        ...(issuesByRequest.get(issueKey) ?? []),
        issue,
      ]);
    }
    let acquisition = await collectHubRequestAcquisition(request, issue);
    if (acquisition.phase === 'failed' && !issue) {
      issue = await recordAcquisitionIssue({
        requestSource: 'hub',
        requestId: request.id,
        kind: request.kind,
        externalId: request.externalId,
        is4k: false,
        reasonCode:
          request.state === HubRequestState.FAILED
            ? 'submission_failed'
            : 'provider_failed',
        requestedBy: request.requestedBy,
      });
      issuesByRequest.set(issueKey, [
        ...(issuesByRequest.get(issueKey) ?? []),
        issue,
      ]);
      acquisition = { ...acquisition, issue: acquisitionIssueDto(issue) };
    } else if (
      issue &&
      (acquisition.availability === 'available' ||
        acquisition.availability === 'imported')
    ) {
      await resolveAcquisitionIssues('hub', request.id);
      issuesByRequest.delete(issueKey);
      acquisition = { ...acquisition, issue: undefined };
    }
    return {
      ...toHubRequestDto(request, { admin }),
      id: `hub:${request.id}`,
      source: 'hub' as const,
      sourceId: request.id,
      acquisition,
    };
  });
  const filtered = [...hub, ...video]
    .filter((item) => pageItemIds.has(item.id))
    .filter((item) => !requestedKinds.size || requestedKinds.has(item.kind))
    .filter(
      (item) =>
        !requestedFormats.size ||
        ('formats' in item &&
          item.formats?.some((format) => requestedFormats.has(format)))
    )
    .filter((item) => !requestedStates.size || requestedStates.has(item.state))
    .filter(
      (item) =>
        !activityQuery ||
        item.title.toLocaleLowerCase().includes(activityQuery) ||
        ('subtitle' in item &&
          item.subtitle?.toLocaleLowerCase().includes(activityQuery))
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  const resultSkip = parsed.data.skip;
  const results = filtered.slice(resultSkip, resultSkip + take);
  const scanExhausted =
    filteredActivity &&
    (pageHubRequests.length >= pageScanLimit ||
      pageVideoRequests.length >= pageScanLimit);
  const hasMoreInWindow = resultSkip + results.length < filtered.length;
  const nextScanCursor = hasMoreInWindow
    ? parsed.data.scanCursor
    : scanExhausted
      ? parsed.data.scanCursor + pageScanLimit
      : undefined;
  const nextSkip = hasMoreInWindow
    ? resultSkip + results.length
    : scanExhausted
      ? 0
      : undefined;
  const queue = [
    ...new Map(
      video
        .filter((item) => item.downloadProgress)
        .map((item) => [
          `${item.kind}:${item.externalId}:${item.is4k}`,
          {
            id: item.id,
            kind: item.kind,
            externalId: item.externalId,
            title: item.title,
            imageUrl: item.imageUrl,
            is4k: item.is4k,
            downloadProgress: item.downloadProgress!,
          },
        ])
    ).values(),
  ];
  type AcquisitionQueueItem = {
    id: string;
    kind: HubMediaKind | MediaType;
    externalId: string;
    title: string;
    imageUrl?: string;
    is4k?: boolean;
    acquisition: HubAcquisition;
  };
  const acquisitionItems: AcquisitionQueueItem[] = [...video, ...hub]
    .filter((item) =>
      [
        'queued',
        'downloading',
        'paused',
        'repairing',
        'verifying',
        'extracting',
        'import_pending',
        'importing',
        'failed',
        'waiting_for_release',
        'searching',
        'partially_available',
        'unknown',
      ].includes(item.acquisition.phase)
    )
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      externalId: item.externalId,
      title: item.title,
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...('is4k' in item ? { is4k: item.is4k } : {}),
      acquisition: item.acquisition,
    }));
  type AcquisitionGroup =
    | 'downloading'
    | 'queued'
    | 'processing'
    | 'paused'
    | 'problems';
  const acquisitionGroupFor = (
    acquisition: HubAcquisition
  ): AcquisitionGroup => {
    if (acquisition.phase === 'failed' || acquisition.health === 'error') {
      return 'problems';
    }
    if (acquisition.phase === 'paused') return 'paused';
    if (
      acquisition.phase === 'unknown' ||
      acquisition.health === 'warning' ||
      acquisition.health === 'stale' ||
      acquisition.stale
    ) {
      return 'problems';
    }
    if (
      [
        'repairing',
        'verifying',
        'extracting',
        'import_pending',
        'importing',
      ].includes(acquisition.phase)
    ) {
      return 'processing';
    }
    if (acquisition.phase === 'downloading') return 'downloading';
    return 'queued';
  };
  const grouped = (wanted: AcquisitionGroup) =>
    acquisitionItems.filter(
      (item) => acquisitionGroupFor(item.acquisition) === wanted
    );
  const totalBytes = acquisitionItems.reduce(
    (sum, item) => sum + item.acquisition.totalBytes,
    0
  );
  const downloadedBytes = acquisitionItems.reduce(
    (sum, item) => sum + item.acquisition.downloadedBytes,
    0
  );
  const problems = grouped('problems');
  const issueItems = acquisitionItems.flatMap((item) => {
    const source = item.id.startsWith('video:') ? 'seerr' : 'hub';
    const requestId = Number(item.id.split(':')[1]);
    return (
      issuesByRequest.get(`${source}:${requestId}:${item.is4k ?? false}`) ?? []
    ).map((issue) => ({
      ...item,
      id: `${item.id}:issue:${issue.id}`,
      acquisition: {
        ...item.acquisition,
        phase: 'failed' as const,
        health: 'error' as const,
        issue: acquisitionIssueDto(issue),
      },
    }));
  });
  const issueRequestIds = new Set(
    issueItems.map((item) => item.id.split(':issue:')[0])
  );
  const problemItems = [
    ...issueItems,
    ...problems.filter((item) => !issueRequestIds.has(item.id)),
  ];
  const requestDetails = new Map(
    [...video, ...hub].map((item) => [
      `${item.source}:${item.sourceId}`,
      { title: item.title, kind: item.kind },
    ])
  );
  const recentIssues = recentResolvedIssues.flatMap((issue) => {
    const details = requestDetails.get(
      `${issue.requestSource}:${issue.requestId}`
    );
    if (!details || !issue.resolvedAt) return [];
    return [
      {
        source: issue.requestSource,
        requestId: issue.requestId,
        title: details.title,
        kind: details.kind,
        reasonCode: issue.reasonCode,
        message: issue.message,
        resolvedAt: issue.resolvedAt.toISOString(),
        acknowledged: Boolean(issue.acknowledgedAt),
      },
    ];
  });
  const processing = grouped('processing');
  const queued = grouped('queued');
  const downloading = grouped('downloading');
  const paused = grouped('paused');
  const acquisitionQueue = {
    summary: {
      total: acquisitionItems.length,
      queued: queued.length,
      downloading: downloading.length,
      processing: processing.length,
      paused: paused.length,
      failed: problemItems.length,
      waitingForRelease: acquisitionItems.filter(
        (item) => item.acquisition.phase === 'waiting_for_release'
      ).length,
      importPending: acquisitionItems.filter(
        (item) => item.acquisition.phase === 'import_pending'
      ).length,
      progress: totalBytes
        ? Math.round((downloadedBytes / totalBytes) * 100)
        : 0,
      downloadedBytes,
      totalBytes,
    },
    groups: {
      downloading,
      queued,
      paused,
      processing,
      problems: problemItems,
    },
    issues: problemItems,
    recentIssues,
    observedAt: new Date().toISOString(),
    lastUpdatedAt: trackerStatus.lastSuccessfulSyncAt,
    stale: trackerStatus.stale,
  };
  return res.json({
    results,
    queue,
    acquisitionQueue,
    take,
    skip: parsed.data.skip,
    total: filtered.length,
    totalIsEstimate: filteredActivity,
    scanExhausted,
    nextScanCursor,
    nextSkip,
    hasMore: hasMoreInWindow || scanExhausted,
  });
});

hubRoutes.post('/requests', hubCreateLimiter, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: 'Ungültiger Wunsch', issues: parsed.error.issues });
  }
  const user = req.user as User;
  const body = parsed.data;
  const externalId =
    body.provider === 'musicbrainz'
      ? body.externalId.toLowerCase()
      : body.externalId.toUpperCase();
  const formats =
    body.kind === HubMediaKind.BOOK
      ? body.formats?.length
        ? [...new Set(body.formats)]
        : [HubRequestFormat.EBOOK]
      : [];
  const points = configuredHubRequestPoints(body.kind, formats);
  const target = body.kind === HubMediaKind.BOOK ? 'lazylibrarian' : 'lidarr';
  const idempotencyKey = createHash('sha256')
    .update(
      `${user.id}:${body.kind}:${body.provider}:${externalId}:${formats.sort().join(',')}`
    )
    .digest('hex');
  const repository = getRepository(HubRequest);
  const existing = await repository.findOne({
    where: [
      { idempotencyKey },
      { provider: body.provider, externalId, kind: body.kind },
    ],
  });
  if (existing) {
    return res.status(409).json(duplicateResponse);
  }

  let catalogItem: Awaited<ReturnType<typeof resolveHubCatalogItem>>;
  let canonicalIsbn: string | undefined;
  try {
    catalogItem = await resolveHubCatalogItem({
      kind: body.kind,
      provider: body.provider,
      externalId,
    });
    if (body.editionId) {
      const detail = await resolveHubCatalogDetail({
        kind: body.kind,
        provider: body.provider,
        externalId,
      });
      const edition = detail.editions.find(
        (candidate) => candidate.id === body.editionId?.toUpperCase()
      );
      if (!edition) throw new HubCatalogItemNotFoundError();
      canonicalIsbn = edition.isbn[0];
    }
  } catch (error) {
    if (error instanceof HubCatalogItemNotFoundError) {
      return res.status(422).json({
        code: 'HUB_CATALOG_ITEM_NOT_FOUND',
        message: 'Der ausgewählte Medieneintrag konnte nicht bestätigt werden.',
      });
    }
    return res.status(502).json({ message: providerUnavailableMessage });
  }
  let request: HubRequest;
  try {
    request = await repository.save(
      new HubRequest({
        kind: catalogItem.kind,
        provider: catalogItem.provider,
        externalId: catalogItem.externalId,
        editionId: body.editionId?.toUpperCase(),
        isbn: canonicalIsbn,
        title: catalogItem.title,
        subtitle: catalogItem.subtitle,
        imageUrl: catalogItem.imageUrl,
        formats,
        languages: body.languages?.length ? body.languages : ['de', 'en'],
        points,
        targetService: target,
        requestedBy: user,
        state: HubRequestState.PENDING,
        idempotencyKey,
        errorMessage: 'Manuelle Freigabe erforderlich.',
      })
    );
  } catch {
    const duplicate = await repository.findOne({
      where: [
        { idempotencyKey },
        {
          provider: body.provider,
          externalId,
          kind: body.kind,
        },
      ],
    });
    if (duplicate) return res.status(409).json(duplicateResponse);
    return res.status(500).json({ message: requestFailedMessage });
  }
  const quotaReservation = await reserveHubQuota(request, user);
  const approval = {
    allowed: quotaReservation.allowed,
    reason: quotaReservation.allowed
      ? undefined
      : quotaReservation.status.enabled
        ? 'Punktebudget ausgeschöpft; manuelle Freigabe erforderlich.'
        : 'Automatische Freigabe ist deaktiviert.',
  };
  if (approval.allowed) {
    request.state = HubRequestState.APPROVED;
    request.approvedBy = user;
    request.approvedAt = new Date();
    request.errorMessage = null;
    request = await repository.save(request);
  } else {
    request.errorMessage = approval.reason;
    request = await repository.save(request);
  }
  await addAudit(request, 'created', user, {
    autoApproved: approval.allowed,
    reason: approval.reason,
  });
  await notifyHomeAssistant(
    approval.allowed ? 'request_auto_approved' : 'request_pending',
    { requestId: request.id, title: request.title, kind: request.kind }
  );

  if (approval.allowed) {
    try {
      request = await repository.save(await submitHubRequest(request));
      await consumeHubQuota(request.id);
      await addAudit(request, 'submitted', user, {
        target: request.targetService,
      });
      await notifyHomeAssistant('request_submitted', {
        requestId: request.id,
        title: request.title,
        target: request.targetService,
      });
    } catch {
      logger.error('Hub request submission failed', {
        label: 'StefARR',
        requestId: request.id,
      });
      request.state = HubRequestState.FAILED;
      request.errorMessage = HUB_SUBMISSION_FAILED_MESSAGE;
      request = await repository.save(request);
      await releaseHubQuota(request.id);
      await addAudit(request, 'failed', user, {
        message: HUB_SUBMISSION_FAILED_MESSAGE,
      });
      await notifyHomeAssistant('request_failed', {
        requestId: request.id,
        title: request.title,
        message: HUB_SUBMISSION_FAILED_MESSAGE,
      });
    }
  }
  return res.status(201).json(toHubRequestDto(request, { admin: false }));
});

hubRoutes.post(
  '/requests/:id/approve',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const repository = getRepository(HubRequest);
    const claimed = await repository.update(
      { id: id.data, state: HubRequestState.PENDING },
      {
        state: HubRequestState.PROCESSING,
        approvedBy: actor,
        approvedAt: new Date(),
        errorMessage: null,
      }
    );
    if (claimed.affected !== 1) {
      return res.status(409).json({
        message: 'Der Wunsch ist nicht mehr zur Freigabe verfügbar.',
      });
    }
    let request = await repository.findOneByOrFail({ id: id.data });
    try {
      request = await repository.save(await submitHubRequest(request));
      await consumeHubQuota(request.id);
      await addAudit(request, 'approved_and_submitted', actor);
    } catch {
      request.state = HubRequestState.FAILED;
      request.errorMessage = HUB_SUBMISSION_FAILED_MESSAGE;
      request = await repository.save(request);
      await addAudit(request, 'failed', actor, {
        message: HUB_SUBMISSION_FAILED_MESSAGE,
      });
    }
    return res.json(toHubRequestDto(request, { admin: true }));
  }
);

hubRoutes.post(
  '/acquisition/issues/:id/acknowledge',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    if (
      !actor.hasPermission([Permission.ADMIN, Permission.MANAGE_REQUESTS], {
        type: 'or',
      })
    ) {
      return res.sendStatus(403);
    }
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const repository = getRepository(HubAcquisitionIssue);
    const visibleWhere = visibleAcquisitionIssueWhere(actor);
    const acknowledged = await repository.update(
      { id: id.data, ...visibleWhere, resolvedAt: IsNull() },
      { acknowledgedAt: new Date() }
    );
    if (acknowledged.affected !== 1) return res.sendStatus(404);
    const issue = await repository.findOneOrFail({
      where: { id: id.data, ...visibleWhere },
    });
    return res.json(acquisitionIssueDto(issue));
  }
);

hubRoutes.post(
  '/acquisition/issues/:id/retry',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    const canManage = actor.hasPermission(
      [Permission.ADMIN, Permission.MANAGE_REQUESTS],
      { type: 'or' }
    );
    if (!canManage) return res.sendStatus(403);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const repository = getRepository(HubAcquisitionIssue);
    const issue = await repository.findOne({
      where: {
        id: id.data,
        ...visibleAcquisitionIssueWhere(actor),
      },
    });
    if (!issue) return res.sendStatus(404);
    if (issue.resolvedAt) {
      return res.status(409).json({
        message: 'Dieses Providerproblem wird bereits wiederholt.',
      });
    }
    if (!issue.retryable) {
      return res.status(409).json({
        message:
          'Dieses Providerproblem kann nicht automatisch wiederholt werden.',
      });
    }
    const previousAcknowledgedAt = issue.acknowledgedAt ?? null;
    const claimedAt = new Date();
    const claimed = await repository.update(
      { id: issue.id, resolvedAt: IsNull() },
      { resolvedAt: claimedAt }
    );
    if (claimed.affected !== 1) {
      return res.status(409).json({
        message: 'Dieses Providerproblem wird bereits wiederholt.',
      });
    }
    try {
      if (issue.requestSource === 'hub') {
        const requestRepository = getRepository(HubRequest);
        let request = await requestRepository.findOneByOrFail({
          id: issue.requestId,
          state: HubRequestState.FAILED,
        });
        request.state = HubRequestState.PROCESSING;
        request.errorMessage = null;
        request = await requestRepository.save(request);
        request = await requestRepository.save(await submitHubRequest(request));
        await addAudit(request, 'retried', actor);
      } else {
        const requestRepository = getRepository(MediaRequest);
        const request = await requestRepository.findOneByOrFail({
          id: issue.requestId,
        });
        if (request.status === MediaRequestStatus.FAILED) {
          request.status = MediaRequestStatus.APPROVED;
          request.modifiedBy = actor;
          await requestRepository.save(request);
        } else if (
          request.status === MediaRequestStatus.APPROVED ||
          request.status === MediaRequestStatus.COMPLETED
        ) {
          const serviceId =
            request.media[request.is4k ? 'serviceId4k' : 'serviceId'];
          const externalServiceId =
            request.media[
              request.is4k ? 'externalServiceId4k' : 'externalServiceId'
            ];
          if (serviceId == null || externalServiceId == null) throw new Error();
          if (request.type === MediaType.MOVIE) {
            const server = getSettings().radarr.find(
              (candidate) => candidate.id === serviceId
            );
            if (!server) throw new Error();
            await new RadarrAPI({
              apiKey: server.apiKey,
              url: RadarrAPI.buildUrl(server, '/api/v3'),
            }).retryMovieSearch(externalServiceId);
          } else {
            const server = getSettings().sonarr.find(
              (candidate) => candidate.id === serviceId
            );
            if (!server) throw new Error();
            const sonarr = new SonarrAPI({
              apiKey: server.apiKey,
              url: SonarrAPI.buildUrl(server, '/api/v3'),
            });
            const episode = /^S(\d+)E(\d+)$/.exec(issue.partKey);
            if (episode) {
              await sonarr.retryEpisodeSearch(
                externalServiceId,
                Number(episode[1]),
                Number(episode[2])
              );
            } else {
              await sonarr.retrySeriesSearch(externalServiceId);
            }
          }
        } else {
          throw new Error();
        }
      }
      await repository.update(
        { id: issue.id },
        { acknowledgedAt: previousAcknowledgedAt ?? claimedAt }
      );
      const resolvedIssue = await repository.findOneByOrFail({ id: issue.id });
      return res.json(acquisitionIssueDto(resolvedIssue));
    } catch {
      await repository.update(
        { id: issue.id },
        { resolvedAt: null, acknowledgedAt: previousAcknowledgedAt }
      );
      if (issue.requestSource === 'hub') {
        const requestRepository = getRepository(HubRequest);
        const failedRequest = await requestRepository.findOneBy({
          id: issue.requestId,
        });
        if (failedRequest) {
          failedRequest.state = HubRequestState.FAILED;
          failedRequest.errorMessage = HUB_SUBMISSION_FAILED_MESSAGE;
          await requestRepository.save(failedRequest);
          await addAudit(failedRequest, 'retry_failed', actor, {
            message: HUB_SUBMISSION_FAILED_MESSAGE,
          });
        }
      }
      return res.status(409).json({
        message:
          'Der fehlgeschlagene Download konnte nicht erneut gestartet werden.',
      });
    }
  }
);

hubRoutes.post(
  '/requests/:id/retry',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const repository = getRepository(HubRequest);
    const claimed = await repository.update(
      { id: id.data, state: HubRequestState.FAILED },
      { state: HubRequestState.PROCESSING, errorMessage: null }
    );
    if (claimed.affected !== 1) {
      return res.status(409).json({
        message: 'Nur fehlgeschlagene Wünsche können erneut versucht werden.',
      });
    }
    let request = await repository.findOneByOrFail({ id: id.data });
    try {
      request = await repository.save(await submitHubRequest(request));
      await addAudit(request, 'retried', actor);
      await resolveAcquisitionIssues('hub', request.id);
    } catch {
      request.state = HubRequestState.FAILED;
      request.errorMessage = HUB_SUBMISSION_FAILED_MESSAGE;
      request = await repository.save(request);
      await addAudit(request, 'retry_failed', actor, {
        message: HUB_SUBMISSION_FAILED_MESSAGE,
      });
    }
    return res.json(toHubRequestDto(request, { admin: true }));
  }
);

hubRoutes.post(
  '/requests/:id/decline',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const body = declineSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return res.status(400).json({ message: 'Ungültiger Ablehnungsgrund.' });
    }
    const repository = getRepository(HubRequest);
    const reason = String(body.data.reason ?? 'Vom Administrator abgelehnt');
    const declined = await repository.update(
      { id: id.data, state: HubRequestState.PENDING },
      {
        state: HubRequestState.DECLINED,
        errorMessage: reason,
      }
    );
    if (declined.affected !== 1) {
      return res.status(409).json({
        message: 'Nur wartende Wünsche können abgelehnt werden.',
      });
    }
    const request = await repository.findOneByOrFail({ id: id.data });
    await releaseHubQuota(request.id);
    await addAudit(request, 'declined', actor, {
      reason,
    });
    return res.json(toHubRequestDto(request, { admin: true }));
  }
);

hubRoutes.use(
  (
    error: { status?: number },
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (res.headersSent) return next(error);
    logger.error('Hub route failed', {
      label: 'StefARR',
      method: req.method,
      path: req.path,
    });
    const status =
      error.status && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
    return res.status(status).json({ message: requestFailedMessage });
  }
);

export default hubRoutes;
