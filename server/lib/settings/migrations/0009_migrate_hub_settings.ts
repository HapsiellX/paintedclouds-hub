import { encryptHubSecret } from '@server/lib/hub/secrets';
import type { AllSettings, HubSettings } from '@server/lib/settings';
import fs from 'fs';

const readEnvironmentSecret = (name: string): string | undefined => {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filename = process.env[`${name}_FILE`];
  if (!filename) return undefined;
  return fs.readFileSync(filename, 'utf8').trim() || undefined;
};

const migrateHubSettings = (settings: any): AllSettings => {
  if (settings.migrations?.includes('0009_migrate_hub_settings'))
    return settings;

  const lidarrKey = readEnvironmentSecret('HUB_LIDARR_API_KEY');
  const lazyLibrarianKey = readEnvironmentSecret('HUB_LAZYLIBRARIAN_API_KEY');
  const webhook = readEnvironmentSecret('HUB_HOME_ASSISTANT_WEBHOOK_URL');
  const imported = Boolean(
    process.env.HUB_LIDARR_URL ||
    process.env.HUB_LAZYLIBRARIAN_URL ||
    lidarrKey ||
    lazyLibrarianKey ||
    webhook
  );

  const hub: HubSettings = {
    enabled: true,
    configurationVersion: 2,
    environmentImported: imported,
    lidarr: {
      url: process.env.HUB_LIDARR_URL?.replace(/\/$/, '') ?? '',
      rootFolder: process.env.HUB_LIDARR_ROOT ?? '/music',
      qualityProfileId: Number(process.env.HUB_LIDARR_QUALITY_PROFILE_ID ?? 0),
      metadataProfileId: Number(
        process.env.HUB_LIDARR_METADATA_PROFILE_ID ?? 0
      ),
      apiKey: lidarrKey
        ? encryptHubSecret(lidarrKey, 'lidarr-api-key')
        : undefined,
    },
    lazyLibrarian: {
      url: process.env.HUB_LAZYLIBRARIAN_URL?.replace(/\/$/, '') ?? '',
      apiKey: lazyLibrarianKey
        ? encryptHubSecret(lazyLibrarianKey, 'lazylibrarian-api-key')
        : undefined,
    },
    prowlarr: { url: '' },
    sabnzbd: { url: '' },
    torrentFallback: {
      enabled: false,
      vpnGateUrl: '',
      allowedExitCountries: ['DK'],
      minSeeders: 2,
      retryCooldownMinutes: 30,
    },
    homeAssistant: {
      webhookUrl: webhook
        ? encryptHubSecret(webhook, 'home-assistant-webhook')
        : undefined,
    },
    metadata: {
      contactEmail: process.env.HUB_METADATA_CONTACT_EMAIL ?? '',
      userAgent: process.env.HUB_METADATA_USER_AGENT ?? '',
    },
    defaults: { languages: ['de', 'en'], bookFormats: ['ebook'] },
    quota: {
      enabled: false,
      defaultPoints: 10,
      windowDays: 30,
      weights: {
        movie: 1,
        tv: 3,
        music_album: 1,
        music_artist: 5,
        ebook: 1,
        audiobook: 2,
        book_both: 3,
      },
    },
    sync: { intervalMinutes: 5 },
  };
  settings.hub = { ...hub, ...(settings.hub ?? {}) };
  settings.jobs = settings.jobs ?? {};
  settings.jobs['hub-reconciliation'] ??= { schedule: '0 */5 * * * *' };
  settings.migrations = settings.migrations ?? [];
  settings.migrations.push('0009_migrate_hub_settings');
  return settings;
};

export default migrateHubSettings;
