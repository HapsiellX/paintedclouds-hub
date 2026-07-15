import { searchHubCatalog } from '@server/api/hub/catalog';
import {
  HubMediaKind,
  HubRequestFormat,
  HubRequestState,
  hubRequestPoints,
} from '@server/constants/hub';
import { getRepository } from '@server/datasource';
import { HubAuditEvent } from '@server/entity/HubAuditEvent';
import { HubRequest } from '@server/entity/HubRequest';
import type { User } from '@server/entity/User';
import { submitHubRequest } from '@server/lib/hub/acquisition';
import {
  getHubServiceStatus,
  getStorageUsage,
} from '@server/lib/hub/integrations';
import { notifyHomeAssistant } from '@server/lib/hub/notifications';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { createHash } from 'crypto';
import { Router } from 'express';
import { In, MoreThanOrEqual } from 'typeorm';
import { z } from 'zod';

const hubRoutes = Router();

const requestSchema = z.object({
  kind: z.enum([
    HubMediaKind.MUSIC_ARTIST,
    HubMediaKind.MUSIC_ALBUM,
    HubMediaKind.BOOK,
  ]),
  provider: z.enum(['musicbrainz', 'openlibrary']),
  externalId: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  subtitle: z.string().max(500).optional(),
  imageUrl: z.string().url().max(2_000).optional(),
  formats: z
    .array(z.enum([HubRequestFormat.EBOOK, HubRequestFormat.AUDIOBOOK]))
    .optional(),
  languages: z.array(z.string().min(2).max(8)).max(5).optional(),
});

const activeStates = [
  HubRequestState.PENDING,
  HubRequestState.APPROVED,
  HubRequestState.SUBMITTED,
  HubRequestState.DOWNLOADING,
  HubRequestState.IMPORTED,
];

const addAudit = async (
  request: HubRequest,
  action: string,
  actor?: User,
  details?: Record<string, unknown>
) => {
  await getRepository(HubAuditEvent).save({ request, action, actor, details });
};

const canAutoApprove = async (
  user: User,
  points: number,
  target: string
): Promise<{ allowed: boolean; reason?: string }> => {
  if (user.hasPermission(Permission.ADMIN)) return { allowed: true };

  const requestRepository = getRepository(HubRequest);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const [recent, active, services, storage] = await Promise.all([
    requestRepository.find({
      where: {
        requestedBy: { id: user.id },
        createdAt: MoreThanOrEqual(since),
      },
    }),
    requestRepository.count({
      where: { requestedBy: { id: user.id }, state: In(activeStates) },
    }),
    getHubServiceStatus(),
    getStorageUsage(),
  ]);
  if (recent.reduce((sum, item) => sum + item.points, 0) + points > 10) {
    return { allowed: false, reason: 'Das 30-Tage-Limit wurde erreicht.' };
  }
  if (active >= 5) {
    return { allowed: false, reason: 'Es sind bereits fünf Wünsche offen.' };
  }
  if ((storage.usedPercent ?? 0) >= 85) {
    return {
      allowed: false,
      reason: 'Der Medienspeicher ist zu mehr als 85 % belegt.',
    };
  }
  const service = services.find((item) => item.id === target);
  if (!service?.healthy) {
    return {
      allowed: false,
      reason: `${service?.name ?? target} ist nicht bereit.`,
    };
  }
  return { allowed: true };
};

hubRoutes.get('/search', async (req, res) => {
  const query = String(req.query.query ?? '').trim();
  if (query.length < 2) {
    return res
      .status(400)
      .json({ message: 'Mindestens zwei Zeichen eingeben.' });
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
    return res.json(results);
  } catch (e) {
    return res.status(502).json({ message: e.message });
  }
});

hubRoutes.get('/overview', async (_req, res) => {
  const [services, storage, requests] = await Promise.all([
    getHubServiceStatus(),
    getStorageUsage(),
    getRepository(HubRequest).find({ order: { createdAt: 'DESC' }, take: 8 }),
  ]);
  return res.json({ services, storage, requests });
});

hubRoutes.get('/requests', async (req, res) => {
  const user = req.user as User;
  const admin = user.hasPermission(Permission.ADMIN);
  const requests = await getRepository(HubRequest).find({
    where: admin ? {} : { requestedBy: { id: user.id } },
    order: { createdAt: 'DESC' },
    take: Math.min(Number(req.query.take ?? 100), 250),
  });
  return res.json({ results: requests });
});

hubRoutes.post('/requests', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: 'Ungültiger Wunsch', issues: parsed.error.issues });
  }
  const user = req.user as User;
  const body = parsed.data;
  const formats =
    body.kind === HubMediaKind.BOOK
      ? body.formats?.length
        ? [...new Set(body.formats)]
        : [HubRequestFormat.EBOOK]
      : [];
  const points = hubRequestPoints(body.kind, formats);
  const target = body.kind === HubMediaKind.BOOK ? 'lazylibrarian' : 'lidarr';
  const approval = await canAutoApprove(user, points, target);
  const idempotencyKey = createHash('sha256')
    .update(
      `${user.id}:${body.kind}:${body.provider}:${body.externalId}:${formats.sort().join(',')}`
    )
    .digest('hex');
  const repository = getRepository(HubRequest);
  const existing = await repository.findOne({
    where: [
      { idempotencyKey },
      { provider: body.provider, externalId: body.externalId, kind: body.kind },
    ],
  });
  if (existing) {
    return res.status(409).json({
      message: 'Dieser Titel wurde bereits gewünscht.',
      request: existing,
    });
  }

  let request = await repository.save(
    new HubRequest({
      ...body,
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
    } catch (e) {
      logger.error('Hub request submission failed', {
        label: 'PaintedClouds Hub',
        requestId: request.id,
        errorMessage: e.message,
      });
      request.state = HubRequestState.FAILED;
      request.errorMessage = e.message;
      request = await repository.save(request);
      await addAudit(request, 'failed', user, { message: e.message });
      await notifyHomeAssistant('request_failed', {
        requestId: request.id,
        title: request.title,
        message: e.message,
      });
    }
  }
  return res.status(201).json(request);
});

hubRoutes.post('/requests/:id/approve', async (req, res) => {
  const actor = req.user as User;
  if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  const repository = getRepository(HubRequest);
  let request = await repository.findOneByOrFail({ id: Number(req.params.id) });
  request.state = HubRequestState.APPROVED;
  request.approvedBy = actor;
  request.approvedAt = new Date();
  request.errorMessage = null;
  await repository.save(request);
  try {
    request = await repository.save(await submitHubRequest(request));
    await addAudit(request, 'approved_and_submitted', actor);
  } catch (e) {
    request.state = HubRequestState.FAILED;
    request.errorMessage = e.message;
    request = await repository.save(request);
    await addAudit(request, 'failed', actor, { message: e.message });
  }
  return res.json(request);
});

hubRoutes.post('/requests/:id/retry', async (req, res) => {
  const actor = req.user as User;
  if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  const repository = getRepository(HubRequest);
  let request = await repository.findOneByOrFail({ id: Number(req.params.id) });
  try {
    request = await repository.save(await submitHubRequest(request));
    await addAudit(request, 'retried', actor);
  } catch (e) {
    request.state = HubRequestState.FAILED;
    request.errorMessage = e.message;
    request = await repository.save(request);
    await addAudit(request, 'retry_failed', actor, { message: e.message });
  }
  return res.json(request);
});

hubRoutes.post('/requests/:id/decline', async (req, res) => {
  const actor = req.user as User;
  if (!actor.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  const repository = getRepository(HubRequest);
  const request = await repository.findOneByOrFail({
    id: Number(req.params.id),
  });
  request.state = HubRequestState.DECLINED;
  request.errorMessage = String(
    req.body?.reason ?? 'Vom Administrator abgelehnt'
  );
  await repository.save(request);
  await addAudit(request, 'declined', actor, { reason: request.errorMessage });
  return res.json(request);
});

export default hubRoutes;
