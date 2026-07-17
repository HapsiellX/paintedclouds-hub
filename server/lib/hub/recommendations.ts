import type { HubCatalogItem } from '@server/api/hub/catalog';
import type { HubMediaKind } from '@server/constants/hub';

export enum HubRecommendationReasonCode {
  LIKED_SIMILAR = 'LIKED_SIMILAR',
  SAVED_SIMILAR = 'SAVED_SIMILAR',
  REQUEST_SIMILAR = 'REQUEST_SIMILAR',
  PREFERRED_GENRE = 'PREFERRED_GENRE',
  PREFERRED_LANGUAGE = 'PREFERRED_LANGUAGE',
  LIBRARY_SIMILAR = 'LIBRARY_SIMILAR',
  POPULAR_COLD_START = 'POPULAR_COLD_START',
  REDISCOVER = 'REDISCOVER',
}

export interface RankingSignal {
  kind: HubMediaKind;
  provider: string;
  externalId: string;
  liked?: boolean;
  saved?: boolean;
  hidden?: boolean;
  genres?: string[] | null;
  languages?: string[] | null;
}

export interface RankingContext {
  preferredKinds: HubMediaKind[];
  preferredGenres: string[];
  preferredLanguages: string[];
  signals: RankingSignal[];
  requestedKeys: Set<string>;
  availableKeys: Set<string>;
  requestedGenres?: string[];
  libraryGenres?: string[];
}

export const hubItemKey = (item: {
  provider: string;
  externalId: string;
  kind: HubMediaKind;
}) => `${item.provider}:${item.kind}:${item.externalId}`;

const overlap = (left: string[] = [], right: string[] = []) => {
  const normalized = new Set(left.map((value) => value.toLowerCase()));
  return right.filter((value) => normalized.has(value.toLowerCase())).length;
};

const deterministicTieBreaker = (item: HubCatalogItem) => {
  let hash = 2166136261;
  for (const character of hubItemKey(item)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const rankHubRecommendations = (
  candidates: HubCatalogItem[],
  context: RankingContext
): HubCatalogItem[] => {
  const signalByKey = new Map(
    context.signals.map((signal) => [hubItemKey(signal), signal])
  );
  const liked = context.signals.filter((signal) => signal.liked);
  const saved = context.signals.filter((signal) => signal.saved);
  const hasPersonalSignals = liked.length > 0 || saved.length > 0;

  return candidates
    .filter((item, index, all) => {
      const key = hubItemKey(item);
      return (
        all.findIndex((other) => hubItemKey(other) === key) === index &&
        !signalByKey.get(key)?.hidden
      );
    })
    .map((item) => {
      const reasons: { code: HubRecommendationReasonCode; context?: string }[] =
        [];
      let score = Math.min(item.popularity ?? 0, 100) / 100;
      score += Math.max(0, Math.min(item.freshness ?? 0, 1)) * 15;
      const likedGenre = Math.max(
        0,
        ...liked.map((signal) =>
          overlap(signal.genres ?? [], item.genres ?? [])
        )
      );
      const savedGenre = Math.max(
        0,
        ...saved.map((signal) =>
          overlap(signal.genres ?? [], item.genres ?? [])
        )
      );
      const preferredGenre = overlap(
        context.preferredGenres,
        item.genres ?? []
      );
      const preferredLanguage = overlap(
        context.preferredLanguages,
        item.languages ?? []
      );
      const libraryGenre = overlap(
        context.libraryGenres ?? [],
        item.genres ?? []
      );
      const requestGenre = overlap(
        context.requestedGenres ?? [],
        item.genres ?? []
      );

      if (likedGenre) {
        score += 100 + likedGenre * 10;
        reasons.push({ code: HubRecommendationReasonCode.LIKED_SIMILAR });
      }
      if (savedGenre) {
        score += 60 + savedGenre * 5;
        reasons.push({ code: HubRecommendationReasonCode.SAVED_SIMILAR });
      }
      if (requestGenre || context.requestedKeys.has(hubItemKey(item))) {
        score += 40 + requestGenre * 4;
        reasons.push({ code: HubRecommendationReasonCode.REQUEST_SIMILAR });
      }
      if (preferredGenre) {
        score += 20 + preferredGenre * 4;
        reasons.push({
          code: HubRecommendationReasonCode.PREFERRED_GENRE,
          context: item.genres?.find((genre) =>
            context.preferredGenres
              .map((value) => value.toLowerCase())
              .includes(genre.toLowerCase())
          ),
        });
      }
      if (preferredLanguage) {
        score += 12;
        reasons.push({
          code: HubRecommendationReasonCode.PREFERRED_LANGUAGE,
          context: item.languages?.[0],
        });
      }
      if (libraryGenre) {
        score += 8;
        reasons.push({ code: HubRecommendationReasonCode.LIBRARY_SIMILAR });
      }
      if (!hasPersonalSignals && !preferredGenre && !preferredLanguage) {
        reasons.push({ code: HubRecommendationReasonCode.POPULAR_COLD_START });
      }
      if (context.preferredKinds.includes(item.kind)) score += 3;
      if (context.availableKeys.has(hubItemKey(item))) {
        reasons.unshift({ code: HubRecommendationReasonCode.REDISCOVER });
      }
      if (!reasons.length) {
        reasons.push({
          code: HubRecommendationReasonCode.POPULAR_COLD_START,
        });
      }

      return {
        item: {
          ...item,
          available: context.availableKeys.has(hubItemKey(item)),
          requested: context.requestedKeys.has(hubItemKey(item)),
          saved: signalByKey.get(hubItemKey(item))?.saved ?? false,
          liked: signalByKey.get(hubItemKey(item))?.liked ?? false,
          hidden: false,
          recommendationReasons: reasons.slice(0, 3),
        },
        score,
        tie: deterministicTieBreaker(item),
      };
    })
    .sort((left, right) => right.score - left.score || left.tie - right.tie)
    .map(({ item }) => item);
};

export const diversifyHubRecommendations = (
  ranked: HubCatalogItem[],
  limit: number
) => {
  const queues = new Map<HubMediaKind, HubCatalogItem[]>();
  for (const item of ranked) {
    queues.set(item.kind, [...(queues.get(item.kind) ?? []), item]);
  }
  const output: HubCatalogItem[] = [];
  while (
    output.length < limit &&
    [...queues.values()].some((queue) => queue.length)
  ) {
    for (const queue of queues.values()) {
      const item = queue.shift();
      if (item) output.push(item);
      if (output.length === limit) break;
    }
  }
  return output;
};
