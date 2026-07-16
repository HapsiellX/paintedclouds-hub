import {
  HubCatalogItemNotFoundError,
  discoverHubBooks,
  discoverHubMusic,
  resolveHubCatalogDetail,
  resolveHubCatalogItem,
  searchHubCatalog,
} from '@server/api/hub/catalog';
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
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { submitHubRequest } from '@server/lib/hub/acquisition';
import { withHubMetadataCache } from '@server/lib/hub/cache';
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
  getHubReconciliationStatus,
  reconcileHubRequests,
} from '@server/lib/hub/reconciliation';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

const hubRoutes = Router();

const trustedImageHosts = new Map([
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
  states: z.string().max(300).optional(),
  query: z.string().trim().max(200).optional(),
});

const idSchema = z.coerce.number().int().positive();
const declineSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

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
    if (req.params.section === 'music')
      return res.json(
        sanitizeCatalogResult(
          await withHubMetadataCache(
            'musicbrainz',
            `discover:music:v2:${locale}`,
            () => discoverHubMusic(locale),
            6 * 60 * 60 * 1000
          )
        )
      );
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
  const hubRequest = await getRepository(HubRequest).findOne({
    where: admin
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
  const activityQuery = parsed.data.query?.toLocaleLowerCase();
  const [hubRequests, videoRequests] = await Promise.all([
    getRepository(HubRequest).find({
      where: admin ? {} : { requestedBy: { id: user.id } },
      order: { createdAt: 'DESC' },
      take: 500,
    }),
    getRepository(MediaRequest).find({
      where: admin ? {} : { requestedBy: { id: user.id } },
      order: { createdAt: 'DESC' },
      take: 500,
    }),
  ]);
  const tmdb = new TheMovieDb();
  const video = await Promise.all(
    videoRequests.map(async (request) => {
      const detail = await (
        request.type === MediaType.MOVIE
          ? tmdb.getMovie({
              movieId: request.media.tmdbId,
              language: req.locale,
            })
          : tmdb.getTvShow({ tvId: request.media.tmdbId, language: req.locale })
      ).catch(() => undefined);
      const state =
        request.status === MediaRequestStatus.PENDING
          ? HubRequestState.PENDING
          : request.status === MediaRequestStatus.DECLINED
            ? HubRequestState.DECLINED
            : request.status === MediaRequestStatus.FAILED
              ? HubRequestState.FAILED
              : request.media.status === MediaStatus.AVAILABLE
                ? HubRequestState.AVAILABLE
                : request.status === MediaRequestStatus.COMPLETED
                  ? HubRequestState.IMPORTED
                  : HubRequestState.SUBMITTED;
      return {
        id: `video:${request.id}`,
        source: 'seerr' as const,
        sourceId: request.id,
        kind: request.type,
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
      };
    })
  );
  const hub = hubRequests.map((request) => ({
    ...toHubRequestDto(request, { admin }),
    id: `hub:${request.id}`,
    source: 'hub' as const,
    sourceId: request.id,
  }));
  const filtered = [...hub, ...video]
    .filter((item) => !requestedKinds.size || requestedKinds.has(item.kind))
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
  const results = filtered.slice(parsed.data.skip, parsed.data.skip + take);
  return res.json({
    results,
    take,
    skip: parsed.data.skip,
    total: filtered.length,
    hasMore: parsed.data.skip + results.length < filtered.length,
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
        label: 'PaintedClouds Hub',
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
