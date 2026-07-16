import {
  discoverHubBooks,
  discoverHubMusic,
  HubCatalogItemNotFoundError,
  resolveHubCatalogItem,
  searchHubCatalog,
} from '@server/api/hub/catalog';
import {
  HubMediaKind,
  HubRequestFormat,
  hubRequestPoints,
  HubRequestState,
} from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
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
import { Permission } from '@server/lib/permissions';
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
    if (req.params.section === 'music')
      return res.json(sanitizeCatalogResult(await discoverHubMusic()));
    if (req.params.section === 'books')
      return res.json(sanitizeCatalogResult(await discoverHubBooks()));
    return res.status(404).json({ message: 'Unbekannter Medienbereich.' });
  } catch {
    return res.status(502).json({ message: providerUnavailableMessage });
  }
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
