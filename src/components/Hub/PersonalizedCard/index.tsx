import {
  BookmarkIcon,
  EyeSlashIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRouter } from 'next/router';

export interface PersonalizedItem {
  kind: 'movie' | 'tv' | 'music_artist' | 'music_album' | 'book';
  provider: 'tmdb' | 'musicbrainz' | 'openlibrary';
  externalId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  year?: number;
  genres?: string[];
  languages?: string[];
  formats?: ('ebook' | 'audiobook')[];
  available?: boolean;
  requested?: boolean;
  downloading?: boolean;
  saved?: boolean;
  liked?: boolean;
  recommendationReasons?: { code: string; context?: string }[];
}

const reasonLabels = {
  de: {
    LIKED_SIMILAR: 'Ähnlich zu einem Titel, der dir gefällt',
    SAVED_SIMILAR: 'Passt zu deiner Merkliste',
    REQUEST_SIMILAR: 'Passt zu deinen Wünschen',
    PREFERRED_GENRE: 'In einem deiner Lieblingsgenres',
    PREFERRED_LANGUAGE: 'In deiner Sprache',
    LIBRARY_SIMILAR: 'Passt zu deiner Bibliothek',
    POPULAR_COLD_START: 'Beliebt und noch nicht in deiner Bibliothek',
    REDISCOVER: 'Schon vorhanden – wiederentdecken',
  },
  en: {
    LIKED_SIMILAR: 'Similar to a title you like',
    SAVED_SIMILAR: 'Matches your saved list',
    REQUEST_SIMILAR: 'Matches your requests',
    PREFERRED_GENRE: 'In one of your favorite genres',
    PREFERRED_LANGUAGE: 'In your language',
    LIBRARY_SIMILAR: 'Similar to your library',
    POPULAR_COLD_START: 'Popular and not in your library yet',
    REDISCOVER: 'Already available – rediscover it',
  },
} as const;

const kindLabels = {
  de: {
    movie: 'Film',
    tv: 'Serie',
    music_artist: 'Künstler',
    music_album: 'Album',
    book: 'Buch',
  },
  en: {
    movie: 'Movie',
    tv: 'Series',
    music_artist: 'Artist',
    music_album: 'Album',
    book: 'Book',
  },
} as const;

const PersonalizedCard = ({
  item,
  locale,
  onChanged,
}: {
  item: PersonalizedItem;
  locale: string;
  onChanged: () => void | Promise<void>;
}) => {
  const router = useRouter();
  const language = locale.startsWith('de') ? 'de' : 'en';
  const update = async (
    state: 'liked' | 'hidden' | 'saved',
    value: boolean
  ) => {
    await axios.put('/api/v1/hub/personalization/items', {
      kind: item.kind,
      provider: item.provider,
      externalId: item.externalId,
      title: item.title,
      subtitle: item.subtitle,
      imageUrl: item.imageUrl,
      genres: item.genres,
      languages: item.languages,
      formats: item.formats,
      liked: state === 'liked' ? value : item.liked,
      hidden: state === 'hidden' ? value : undefined,
      saved: state === 'saved' ? value : item.saved,
    });
    await onChanged();
  };
  const open = () => {
    if (item.kind === 'movie' || item.kind === 'tv')
      void router.push(`/${item.kind}/${item.externalId}`);
    else
      void router.push({
        pathname: '/hub',
        query: { query: item.title, kinds: item.kind },
      });
  };

  const reason = item.recommendationReasons?.[0];
  return (
    <article className="group w-44 flex-none snap-start overflow-hidden rounded-2xl border border-gray-700 bg-gray-800/80 shadow-lg motion-safe:transition motion-safe:hover:-translate-y-1 sm:w-48">
      <button
        className="relative block aspect-[2/3] w-full overflow-hidden bg-gradient-to-br from-indigo-900 to-gray-950 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400"
        onClick={open}
        aria-label={`${item.title} öffnen`}
      >
        {item.imageUrl && (
          <span
            className="absolute inset-0 bg-cover bg-center motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
            style={{ backgroundImage: `url(${item.imageUrl})` }}
          />
        )}
        <span className="absolute left-2 top-2 flex flex-wrap gap-1">
          {item.available && (
            <span className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
              Verfügbar
            </span>
          )}
          {item.requested && (
            <span className="rounded-full bg-amber-600 px-2 py-1 text-[10px] font-bold text-white">
              Gewünscht
            </span>
          )}
          {item.downloading && (
            <span className="rounded-full bg-sky-600 px-2 py-1 text-[10px] font-bold text-white">
              Download
            </span>
          )}
          {item.saved && (
            <span className="rounded-full bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white">
              Merkliste
            </span>
          )}
        </span>
      </button>
      <div className="space-y-3 p-3">
        <div className="min-h-24">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
            {kindLabels[language][item.kind]}
          </span>
          <h3 className="line-clamp-2 font-semibold text-white">
            {item.title}
          </h3>
          <p className="mt-1 line-clamp-1 text-xs text-gray-400">
            {[item.subtitle, item.year].filter(Boolean).join(' · ')}
          </p>
          {reason && (
            <p className="mt-2 line-clamp-2 text-xs text-indigo-200">
              {reasonLabels[language][
                reason.code as keyof (typeof reasonLabels)[typeof language]
              ] ?? reason.code}
              {reason.context ? `: ${reason.context}` : ''}
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button
            data-testid="recommendation-like"
            className={`rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${item.liked ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
            onClick={() => update('liked', !item.liked)}
            aria-label={
              item.liked
                ? `Gefällt mir für ${item.title} entfernen`
                : `${item.title} gefällt mir`
            }
            aria-pressed={item.liked}
          >
            <HandThumbUpIcon className="mx-auto h-5 w-5" />
          </button>
          <button
            data-testid="recommendation-save"
            className={`rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${item.saved ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
            onClick={() => update('saved', !item.saved)}
            aria-label={
              item.saved
                ? `${item.title} von Merkliste entfernen`
                : `${item.title} merken`
            }
            aria-pressed={item.saved}
          >
            <BookmarkIcon className="mx-auto h-5 w-5" />
          </button>
          <button
            data-testid="recommendation-hide"
            className="rounded-lg bg-gray-700 p-2 text-gray-200 hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            onClick={() => update('hidden', true)}
            aria-label={`${item.title} als uninteressant ausblenden`}
          >
            <EyeSlashIcon className="mx-auto h-5 w-5" />
          </button>
        </div>
      </div>
    </article>
  );
};

export default PersonalizedCard;
