import {
  discoverHubBooks,
  discoverHubMusic,
  getHubProviderHealth,
  HubCatalogItemNotFoundError,
  loadHubRecommendationCandidates,
  resolveHubCatalogItem,
  searchHubCatalog,
  searchHubMusicArtists,
} from '@server/api/hub/catalog';
import {
  HubMediaKind,
  HubRequestFormat,
  hubRequestPoints,
  HubRequestState,
} from '@server/constants/hub';
import { MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { HubUserProfile } from '@server/entity/HubUserProfile';
import { HubUserSignal } from '@server/entity/HubUserSignal';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { submitHubRequest } from '@server/lib/hub/acquisition';
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
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
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

const addAudit = async (
  request: HubRequest,
  action: string,
  actor?: User,
  details?: Record<string, unknown>
) => {
  await getRepository(HubAuditEvent).save({ request, action, actor, details });
};

const canAutoApprove = (user: User): { allowed: boolean; reason?: string } => {
  if (user.hasPermission(Permission.ADMIN)) return { allowed: true };
  return { allowed: false, reason: 'Manuelle Freigabe erforderlich.' };
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
    const results = await searchHubCatalog({
      query,
      kinds: requestedKinds.length ? requestedKinds : allKinds,
      language: String(req.query.language ?? req.locale ?? 'de-DE'),
    });
    return res.json(sanitizeCatalogResult(results));
  } catch {
    return res.status(502).json({ message: providerUnavailableMessage });
  }
});

hubRoutes.get('/discover/:section', hubCatalogLimiter, async (req, res) => {
  try {
    if (req.params.section === 'music') {
      const profile = await getOrCreateProfile(req.user as User);
      return res.json(
        sanitizeCatalogResult(
          await discoverHubMusic({
            genres: profile.musicGenres ?? [],
            artists: profile.musicArtists ?? [],
          })
        )
      );
    }
    if (req.params.section === 'books')
      return res.json(sanitizeCatalogResult(await discoverHubBooks()));
    return res.status(404).json({ message: 'Unbekannter Medienbereich.' });
  } catch {
    return res.status(502).json({ message: providerUnavailableMessage });
  }
});

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
    }
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
  });
  return res.json({
    results: requests.map((item) => toHubRequestDto(item, { admin })),
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
  const points = hubRequestPoints(body.kind, formats);
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
  try {
    catalogItem = await resolveHubCatalogItem({
      kind: body.kind,
      provider: body.provider,
      externalId,
    });
  } catch (error) {
    if (error instanceof HubCatalogItemNotFoundError) {
      return res.status(422).json({
        code: 'HUB_CATALOG_ITEM_NOT_FOUND',
        message: 'Der ausgewählte Medieneintrag konnte nicht bestätigt werden.',
      });
    }
    return res.status(502).json({ message: providerUnavailableMessage });
  }
  const approval = canAutoApprove(user);

  let request: HubRequest;
  try {
    request = await repository.save(
      new HubRequest({
        kind: catalogItem.kind,
        provider: catalogItem.provider,
        externalId: catalogItem.externalId,
        title: catalogItem.title,
        subtitle: catalogItem.subtitle,
        imageUrl: catalogItem.imageUrl,
        formats,
        languages: body.languages?.length ? body.languages : ['de', 'en'],
        points,
        targetService: target,
        requestedBy: user,
        state: approval.allowed
          ? HubRequestState.APPROVED
          : HubRequestState.PENDING,
        approvedBy: approval.allowed ? user : undefined,
        approvedAt: approval.allowed ? new Date() : undefined,
        idempotencyKey,
        errorMessage: approval.reason,
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
        label: 'PaintedClouds Hub',
        requestId: request.id,
      });
      request.state = HubRequestState.FAILED;
      request.errorMessage = HUB_SUBMISSION_FAILED_MESSAGE;
      request = await repository.save(request);
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
    let request = await repository.findOneByOrFail({ id: id.data });
    request.state = HubRequestState.APPROVED;
    request.approvedBy = actor;
    request.approvedAt = new Date();
    request.errorMessage = null;
    await repository.save(request);
    try {
      request = await repository.save(await submitHubRequest(request));
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
  '/requests/:id/retry',
  hubManagementLimiter,
  async (req, res) => {
    const actor = req.user as User;
    if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: 'Ungültige ID.' });
    const repository = getRepository(HubRequest);
    let request = await repository.findOneByOrFail({ id: id.data });
    try {
      request = await repository.save(await submitHubRequest(request));
      await addAudit(request, 'retried', actor);
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
    const request = await repository.findOneByOrFail({
      id: id.data,
    });
    request.state = HubRequestState.DECLINED;
    request.errorMessage = String(
      body.data.reason ?? 'Vom Administrator abgelehnt'
    );
    await repository.save(request);
    await addAudit(request, 'declined', actor, {
      reason: request.errorMessage,
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
      label: 'PaintedClouds Hub',
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
