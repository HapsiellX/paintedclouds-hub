export type HubActivityFilters = {
  take: number;
  skip: number;
  kinds?: string;
  formats?: string;
  states?: string;
  query?: string;
  scanCursor?: number;
};

export const buildHubActivityUrl = ({
  take,
  skip,
  kinds,
  formats,
  states,
  query,
  scanCursor,
}: HubActivityFilters): string => {
  const params = new URLSearchParams({
    take: String(take),
    skip: String(skip),
  });

  if (kinds) params.set('kinds', kinds);
  if (formats) params.set('formats', formats);
  if (states) params.set('states', states);
  if (query) params.set('query', query);
  if (scanCursor) params.set('scanCursor', String(scanCursor));

  return `/api/v1/hub/activity?${params.toString()}`;
};
