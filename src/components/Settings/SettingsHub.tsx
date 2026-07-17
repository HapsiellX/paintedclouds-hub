import useLocale from '@app/hooks/useLocale';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

interface HubSettingsResponse {
  enabled: boolean;
  environmentImported: boolean;
  lidarr: {
    url: string;
    rootFolder: string;
    qualityProfileId: number;
    metadataProfileId: number;
    apiKeyConfigured: boolean;
  };
  lazyLibrarian: { url: string; apiKeyConfigured: boolean };
  prowlarr: { url: string; apiKeyConfigured: boolean };
  sabnzbd: { url: string; apiKeyConfigured: boolean };
  homeAssistant: { webhookUrlConfigured: boolean };
  metadata: { contactEmail: string; userAgent: string };
  defaults: { languages: string[]; bookFormats: ('ebook' | 'audiobook')[] };
  quota: {
    enabled: boolean;
    defaultPoints: number;
    windowDays: number;
    weights: Record<string, number>;
  };
  sync: { intervalMinutes: number };
}

const fieldClass =
  'mt-1 w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none';

const SettingsHub = () => {
  const { locale } = useLocale();
  const tr = (de: string, en: string) => (locale === 'de' ? de : en);
  const { data, mutate } = useSWR<HubSettingsResponse>('/api/v1/settings/hub');
  const [form, setForm] = useState<HubSettingsResponse>();
  const [lidarrKey, setLidarrKey] = useState('');
  const [lazyKey, setLazyKey] = useState('');
  const [prowlarrKey, setProwlarrKey] = useState('');
  const [sabnzbdKey, setSabnzbdKey] = useState('');
  const [webhook, setWebhook] = useState('');
  const [clearLidarrKey, setClearLidarrKey] = useState(false);
  const [clearLazyKey, setClearLazyKey] = useState(false);
  const [clearProwlarrKey, setClearProwlarrKey] = useState(false);
  const [clearSabnzbdKey, setClearSabnzbdKey] = useState(false);
  const [clearWebhook, setClearWebhook] = useState(false);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(data), [data]);
  if (!form)
    return (
      <p className="text-gray-400">
        {tr('Hub-Einstellungen werden geladen …', 'Loading Hub settings…')}
      </p>
    );

  const updateService = (
    service: 'lidarr' | 'lazyLibrarian' | 'prowlarr' | 'sabnzbd',
    values: Partial<HubSettingsResponse[typeof service]>
  ) => setForm({ ...form, [service]: { ...form[service], ...values } });

  const save = async () => {
    setSaving(true);
    setMessage(undefined);
    try {
      await axios.put('/api/v1/settings/hub', {
        enabled: form.enabled,
        lidarr: {
          url: form.lidarr.url,
          rootFolder: form.lidarr.rootFolder,
          qualityProfileId: form.lidarr.qualityProfileId,
          metadataProfileId: form.lidarr.metadataProfileId,
          ...(lidarrKey ? { apiKey: lidarrKey } : {}),
          ...(clearLidarrKey ? { clearApiKey: true } : {}),
        },
        lazyLibrarian: {
          url: form.lazyLibrarian.url,
          ...(lazyKey ? { apiKey: lazyKey } : {}),
          ...(clearLazyKey ? { clearApiKey: true } : {}),
        },
        prowlarr: {
          url: form.prowlarr.url,
          ...(prowlarrKey ? { apiKey: prowlarrKey } : {}),
          ...(clearProwlarrKey ? { clearApiKey: true } : {}),
        },
        sabnzbd: {
          url: form.sabnzbd.url,
          ...(sabnzbdKey ? { apiKey: sabnzbdKey } : {}),
          ...(clearSabnzbdKey ? { clearApiKey: true } : {}),
        },
        homeAssistant: {
          ...(webhook ? { webhookUrl: webhook } : {}),
          ...(clearWebhook ? { clearWebhookUrl: true } : {}),
        },
        metadata: form.metadata,
        defaults: form.defaults,
        quota: form.quota,
        sync: form.sync,
      });
      setLidarrKey('');
      setLazyKey('');
      setProwlarrKey('');
      setSabnzbdKey('');
      setWebhook('');
      setClearLidarrKey(false);
      setClearLazyKey(false);
      setClearProwlarrKey(false);
      setClearSabnzbdKey(false);
      setClearWebhook(false);
      await mutate();
      setMessage(
        tr(
          'Hub-Einstellungen wurden sicher gespeichert.',
          'Hub settings were saved securely.'
        )
      );
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? (error.response?.data?.message ?? error.message)
          : tr('Speichern fehlgeschlagen.', 'Saving failed.')
      );
    } finally {
      setSaving(false);
    }
  };

  const test = async (
    service: 'lidarr' | 'lazylibrarian' | 'prowlarr' | 'sabnzbd'
  ) => {
    setMessage(undefined);
    try {
      await axios.post(`/api/v1/settings/hub/test/${service}`);
      setMessage(
        `${
          {
            lidarr: 'Lidarr',
            lazylibrarian: 'LazyLibrarian',
            prowlarr: 'Prowlarr',
            sabnzbd: 'SABnzbd',
          }[service]
        } ${tr('ist erreichbar.', 'is reachable.')}`
      );
    } catch {
      setMessage(
        tr(
          'Verbindungstest fehlgeschlagen. Speichere neue Schlüssel zuerst.',
          'Connection test failed. Save new keys first.'
        )
      );
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">StefARR integrations</h1>
        <p className="mt-2 text-gray-400">
          {tr(
            'Integrationen, Standards, Statusabgleich und sichere automatische Freigaben.',
            'Integrations, defaults, status reconciliation, and safe automatic approval.'
          )}
        </p>
      </header>
      {message && (
        <div className="rounded-md border border-indigo-500/30 bg-indigo-950/40 p-3 text-indigo-100">
          {message}
        </div>
      )}
      {form.environmentImported && (
        <div className="rounded-md border border-amber-500/30 bg-amber-950/30 p-3 text-amber-100">
          {tr(
            'Die bisherige V0.1-Umgebungskonfiguration wurde einmalig importiert.',
            'The previous V0.1 environment configuration was imported once.'
          )}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/50 p-5">
          <h2 className="text-lg font-semibold">Lidarr</h2>
          <label className="block text-sm">
            URL
            <input
              className={fieldClass}
              value={form.lidarr.url}
              onChange={(e) => updateService('lidarr', { url: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            {tr('API-Schlüssel', 'API key')}{' '}
            {form.lidarr.apiKeyConfigured && (
              <span className="text-emerald-400">
                {tr('(gesetzt)', '(configured)')}
              </span>
            )}
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={lidarrKey}
              onChange={(e) => setLidarrKey(e.target.value)}
              placeholder={tr(
                'Leer lassen, um den bestehenden Schlüssel zu behalten',
                'Leave blank to keep the existing key'
              )}
            />
          </label>
          {form.lidarr.apiKeyConfigured && (
            <label className="flex items-center gap-2 text-sm text-red-200">
              <input
                type="checkbox"
                checked={clearLidarrKey}
                onChange={(e) => setClearLidarrKey(e.target.checked)}
              />
              {tr('Gespeicherten Schlüssel löschen', 'Delete stored key')}
            </label>
          )}
          <label className="block text-sm">
            {tr('Root-Verzeichnis', 'Root directory')}
            <input
              className={fieldClass}
              value={form.lidarr.rootFolder}
              onChange={(e) =>
                updateService('lidarr', { rootFolder: e.target.value })
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              {tr('Qualitätsprofil-ID', 'Quality profile ID')}
              <input
                type="number"
                min="0"
                className={fieldClass}
                value={form.lidarr.qualityProfileId}
                onChange={(e) =>
                  updateService('lidarr', {
                    qualityProfileId: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="block text-sm">
              {tr('Metadatenprofil-ID', 'Metadata profile ID')}
              <input
                type="number"
                min="0"
                className={fieldClass}
                value={form.lidarr.metadataProfileId}
                onChange={(e) =>
                  updateService('lidarr', {
                    metadataProfileId: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
            onClick={() => test('lidarr')}
          >
            {tr('Verbindung testen', 'Test connection')}
          </button>
        </div>

        <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/50 p-5">
          <h2 className="text-lg font-semibold">LazyLibrarian</h2>
          <label className="block text-sm">
            URL
            <input
              className={fieldClass}
              value={form.lazyLibrarian.url}
              onChange={(e) =>
                updateService('lazyLibrarian', { url: e.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            {tr('API-Schlüssel', 'API key')}{' '}
            {form.lazyLibrarian.apiKeyConfigured && (
              <span className="text-emerald-400">
                {tr('(gesetzt)', '(configured)')}
              </span>
            )}
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={lazyKey}
              onChange={(e) => setLazyKey(e.target.value)}
              placeholder={tr(
                'Leer lassen, um den bestehenden Schlüssel zu behalten',
                'Leave blank to keep the existing key'
              )}
            />
          </label>
          {form.lazyLibrarian.apiKeyConfigured && (
            <label className="flex items-center gap-2 text-sm text-red-200">
              <input
                type="checkbox"
                checked={clearLazyKey}
                onChange={(e) => setClearLazyKey(e.target.checked)}
              />
              {tr('Gespeicherten Schlüssel löschen', 'Delete stored key')}
            </label>
          )}
          <button
            type="button"
            className="rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
            onClick={() => test('lazylibrarian')}
          >
            {tr('Verbindung testen', 'Test connection')}
          </button>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {(
          [
            {
              id: 'prowlarr' as const,
              name: 'Prowlarr',
              key: prowlarrKey,
              setKey: setProwlarrKey,
              clear: clearProwlarrKey,
              setClear: setClearProwlarrKey,
            },
            {
              id: 'sabnzbd' as const,
              name: 'SABnzbd',
              key: sabnzbdKey,
              setKey: setSabnzbdKey,
              clear: clearSabnzbdKey,
              setClear: setClearSabnzbdKey,
            },
          ] as const
        ).map((service) => (
          <div
            key={service.id}
            className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/50 p-5"
          >
            <div>
              <h2 className="text-lg font-semibold">{service.name}</h2>
              <p className="mt-1 text-sm text-gray-400">
                {tr(
                  'Status- und Warteschlangenüberwachung für die zentrale Übersicht.',
                  'Health and queue monitoring for the central overview.'
                )}
              </p>
            </div>
            <label className="block text-sm">
              URL
              <input
                className={fieldClass}
                value={form[service.id].url}
                onChange={(event) =>
                  updateService(service.id, { url: event.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              {tr('API-Schlüssel', 'API key')}{' '}
              {form[service.id].apiKeyConfigured && (
                <span className="text-emerald-400">
                  {tr('(gesetzt)', '(configured)')}
                </span>
              )}
              <input
                type="password"
                autoComplete="new-password"
                className={fieldClass}
                value={service.key}
                onChange={(event) => service.setKey(event.target.value)}
                placeholder={tr(
                  'Leer lassen, um den bestehenden Schlüssel zu behalten',
                  'Leave blank to keep the existing key'
                )}
              />
            </label>
            {form[service.id].apiKeyConfigured && (
              <label className="flex items-center gap-2 text-sm text-red-200">
                <input
                  type="checkbox"
                  checked={service.clear}
                  onChange={(event) => service.setClear(event.target.checked)}
                />
                {tr('Gespeicherten Schlüssel löschen', 'Delete stored key')}
              </label>
            )}
            <button
              type="button"
              className="rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
              onClick={() => test(service.id)}
            >
              {tr('Verbindung testen', 'Test connection')}
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/50 p-5">
        <h2 className="text-lg font-semibold">
          {tr('Metadaten und Standards', 'Metadata and defaults')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            {tr('Projekt-Kontaktadresse', 'Project contact email')}
            <input
              type="email"
              className={fieldClass}
              value={form.metadata.contactEmail}
              onChange={(e) =>
                setForm({
                  ...form,
                  metadata: { ...form.metadata, contactEmail: e.target.value },
                })
              }
            />
          </label>
          <label className="block text-sm">
            {tr('Eigener User-Agent', 'Custom user agent')}
            <input
              className={fieldClass}
              value={form.metadata.userAgent}
              onChange={(e) =>
                setForm({
                  ...form,
                  metadata: { ...form.metadata, userAgent: e.target.value },
                })
              }
            />
          </label>
          <label className="block text-sm">
            {tr('Standardsprachen', 'Default languages')}
            <input
              className={fieldClass}
              value={form.defaults.languages.join(', ')}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaults: {
                    ...form.defaults,
                    languages: e.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
          <label className="block text-sm">
            {tr('Abgleich alle Minuten', 'Reconcile every number of minutes')}
            <input
              type="number"
              min="1"
              max="60"
              className={fieldClass}
              value={form.sync.intervalMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  sync: { intervalMinutes: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-300">
          {(['ebook', 'audiobook'] as const).map((format) => (
            <label key={format} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.defaults.bookFormats.includes(format)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    defaults: {
                      ...form.defaults,
                      bookFormats: event.target.checked
                        ? [...new Set([...form.defaults.bookFormats, format])]
                        : form.defaults.bookFormats.length > 1
                          ? form.defaults.bookFormats.filter(
                              (current) => current !== format
                            )
                          : form.defaults.bookFormats,
                    },
                  })
                }
              />
              {format === 'ebook' ? 'E-Book' : tr('Hörbuch', 'Audiobook')}
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Home-Assistant-Webhook{' '}
          {form.homeAssistant.webhookUrlConfigured && (
            <span className="text-emerald-400">
              {tr('(gesetzt)', '(configured)')}
            </span>
          )}
          <input
            type="password"
            className={fieldClass}
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder={tr(
              'Leer lassen, um den bestehenden Webhook zu behalten',
              'Leave blank to keep the existing webhook'
            )}
          />
        </label>
        {form.homeAssistant.webhookUrlConfigured && (
          <label className="flex items-center gap-2 text-sm text-red-200">
            <input
              type="checkbox"
              checked={clearWebhook}
              onChange={(e) => setClearWebhook(e.target.checked)}
            />
            {tr('Gespeicherten Webhook löschen', 'Delete stored webhook')}
          </label>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/50 p-5">
        <div className="flex items-center gap-3">
          <input
            id="hub-quota"
            type="checkbox"
            checked={form.quota.enabled}
            onChange={(e) =>
              setForm({
                ...form,
                quota: { ...form.quota, enabled: e.target.checked },
              })
            }
          />
          <label htmlFor="hub-quota" className="font-semibold">
            {tr(
              'Sichere automatische Freigabe aktivieren',
              'Enable safe automatic approval'
            )}
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            {tr('Punkte pro Benutzer', 'Points per user')}
            <input
              type="number"
              min="0"
              className={fieldClass}
              value={form.quota.defaultPoints}
              onChange={(e) =>
                setForm({
                  ...form,
                  quota: {
                    ...form.quota,
                    defaultPoints: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="block text-sm">
            {tr('Rollierendes Fenster in Tagen', 'Rolling window in days')}
            <input
              type="number"
              min="1"
              max="365"
              className={fieldClass}
              value={form.quota.windowDays}
              onChange={(e) =>
                setForm({
                  ...form,
                  quota: { ...form.quota, windowDays: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
        <p className="text-sm text-gray-400">
          {tr(
            'Standardgewichte: Film 1, Serie 3, Album 1, Künstler 5, E-Book 1, Hörbuch 2.',
            'Default weights: movie 1, series 3, album 1, artist 5, e-book 1, audiobook 2.'
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(form.quota.weights).map(([key, weight]) => (
            <label key={key} className="text-sm text-gray-400">
              {key.replaceAll('_', ' ')}
              <input
                type="number"
                min="1"
                max="100"
                className={fieldClass}
                value={weight}
                onChange={(event) =>
                  setForm({
                    ...form,
                    quota: {
                      ...form.quota,
                      weights: {
                        ...form.quota.weights,
                        [key]: Number(event.target.value),
                      },
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="rounded-md bg-indigo-600 px-5 py-2.5 font-semibold hover:bg-indigo-500 disabled:opacity-50"
      >
        {saving
          ? tr('Wird gespeichert …', 'Saving…')
          : tr('Einstellungen speichern', 'Save settings')}
      </button>
    </div>
  );
};

export default SettingsHub;
