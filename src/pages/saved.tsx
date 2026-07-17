import PageTitle from '@app/components/Common/PageTitle';
import PersonalizedCard, {
  type PersonalizedItem,
} from '@app/components/Hub/PersonalizedCard';
import type { NextPage } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import useSWR from 'swr';

interface SavedResponse {
  results: PersonalizedItem[];
  nextCursor: string | null;
}

const SavedPage: NextPage = () => {
  const { locale = 'de' } = useRouter();
  const { data, error, isLoading, mutate } = useSWR<SavedResponse>(
    '/api/v1/hub/saved?pageSize=50'
  );
  return (
    <div className="space-y-7 pb-14">
      <PageTitle title="Merkliste" />
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-300">
          Medienübergreifend
        </p>
        <h1 className="mt-2 text-4xl font-bold text-white">Deine Merkliste</h1>
        <p className="mt-2 text-gray-400">
          Filme, Serien, Musik, Bücher und Hörbücher an einem Ort.
        </p>
      </header>
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-5 text-red-200">
          Die Merkliste konnte nicht geladen werden.
        </div>
      ) : isLoading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-gray-800" />
      ) : data?.results.length ? (
        <div className="flex flex-wrap gap-4" data-testid="saved-list">
          {data.results.map((item) => (
            <PersonalizedCard
              key={`${item.provider}-${item.kind}-${item.externalId}`}
              item={item}
              locale={locale}
              onChanged={async () => {
                await mutate();
              }}
            />
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-gray-700 bg-gray-800/60 p-8 text-center">
          <Image
            src="/images/saved-empty.svg"
            alt=""
            width={260}
            height={190}
            className="mx-auto"
          />
          <h2 className="mt-4 text-2xl font-bold text-white">
            Noch nichts gemerkt
          </h2>
          <p className="mt-2 text-gray-400">
            Speichere Empfehlungen mit dem Lesezeichen – ganz ohne Download oder
            automatischen Wunsch.
          </p>
        </section>
      )}
    </div>
  );
};

export default SavedPage;
