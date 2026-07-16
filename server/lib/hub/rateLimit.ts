import type { User } from '@server/entity/User';
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const keyGenerator = (req: Request): string => {
  const user = req.user as User | undefined;
  return user ? `user:${user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
};

export const createHubRateLimiter = ({
  windowMs,
  limit,
}: {
  windowMs: number;
  limit: number;
}) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Zu viele Hub-Anfragen. Bitte später erneut versuchen.',
      }),
  });

export const hubCatalogLimiter = createHubRateLimiter({
  windowMs: 60_000,
  limit: 30,
});

export const hubReadLimiter = createHubRateLimiter({
  windowMs: 60_000,
  limit: 120,
});

export const hubCreateLimiter = createHubRateLimiter({
  windowMs: 60 * 60_000,
  limit: 10,
});

export const hubManagementLimiter = createHubRateLimiter({
  windowMs: 15 * 60_000,
  limit: 30,
});
