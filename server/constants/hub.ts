export enum HubMediaKind {
  MOVIE = 'movie',
  TV = 'tv',
  MUSIC_ARTIST = 'music_artist',
  MUSIC_ALBUM = 'music_album',
  BOOK = 'book',
}

export enum HubRequestFormat {
  EBOOK = 'ebook',
  AUDIOBOOK = 'audiobook',
}

export enum HubRequestState {
  PENDING = 'pending',
  APPROVED = 'approved',
  SUBMITTED = 'submitted',
  DOWNLOADING = 'downloading',
  IMPORTED = 'imported',
  AVAILABLE = 'available',
  FAILED = 'failed',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
}

export const HUB_REQUEST_POINTS: Record<HubMediaKind, number> = {
  [HubMediaKind.MOVIE]: 1,
  [HubMediaKind.TV]: 3,
  [HubMediaKind.MUSIC_ALBUM]: 1,
  [HubMediaKind.MUSIC_ARTIST]: 5,
  [HubMediaKind.BOOK]: 1,
};

export const hubRequestPoints = (
  kind: HubMediaKind,
  formats: HubRequestFormat[] = []
): number => {
  if (kind !== HubMediaKind.BOOK) {
    return HUB_REQUEST_POINTS[kind];
  }
  if (
    formats.includes(HubRequestFormat.EBOOK) &&
    formats.includes(HubRequestFormat.AUDIOBOOK)
  ) {
    return 3;
  }
  return formats.includes(HubRequestFormat.AUDIOBOOK) ? 2 : 1;
};
