import { getRepository } from '@server/datasource';
import { HubMetadataCache } from '@server/entity/HubMetadataCache';

export const withHubMetadataCache = async <T>(
  provider: string,
  cacheKey: string,
  load: () => Promise<T>,
  ttlMs = 24 * 60 * 60 * 1000,
  staleMs = 7 * 24 * 60 * 60 * 1000
): Promise<T> => {
  const repository = getRepository(HubMetadataCache);
  const now = new Date();
  const cached = await repository.findOne({ where: { provider, cacheKey } });
  if (cached && cached.expiresAt > now) return JSON.parse(cached.payload) as T;
  try {
    const value = await load();
    await repository.save({
      ...(cached ?? {}),
      provider,
      cacheKey,
      payload: JSON.stringify(value),
      expiresAt: new Date(now.getTime() + ttlMs),
      staleUntil: new Date(now.getTime() + staleMs),
      lastError: null,
    });
    return value;
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      cached.lastError = (error as Error).message.slice(0, 1000);
      await repository.save(cached);
      return JSON.parse(cached.payload) as T;
    }
    throw error;
  }
};
