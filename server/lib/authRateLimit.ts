import type { User } from '@server/entity/User';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '')}`;

const userOrIpKey = (req: Request): string => {
  const user = req.user as User | undefined;
  return user ? `user:${user.id}` : ipKey(req);
};

const rateLimitHandler = (_req: Request, res: Response) =>
  res.status(429).json({
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Please try again later.',
  });

export const createAuthRateLimiter = ({
  windowMs,
  limit,
  keyGenerator = ipKey,
  skipSuccessfulRequests = false,
}: {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitHandler,
  });

export const authLoginLimiter = createAuthRateLimiter({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});

export const passwordResetRequestLimiter = createAuthRateLimiter({
  windowMs: 60 * 60_000,
  limit: 10,
});

export const passwordResetConfirmLimiter = createAuthRateLimiter({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
});

export const accountLinkLimiter = createAuthRateLimiter({
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: userOrIpKey,
  skipSuccessfulRequests: true,
});
