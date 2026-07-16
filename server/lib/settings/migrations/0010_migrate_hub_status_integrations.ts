import { encryptHubSecret } from '@server/lib/hub/secrets';
import type { AllSettings } from '@server/lib/settings';
import fs from 'fs';

const migrationId = '0010_migrate_hub_status_integrations';

const readEnvironmentSecret = (name: string): string | undefined => {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filename = process.env[`${name}_FILE`];
  if (!filename) return undefined;
  return fs.readFileSync(filename, 'utf8').trim() || undefined;
};

const migrateHubStatusIntegrations = (settings: any): AllSettings => {
  settings.migrations ??= [];
  if (settings.migrations.includes(migrationId)) return settings;

  const prowlarrKey = readEnvironmentSecret('HUB_PROWLARR_API_KEY');
  const sabnzbdKey = readEnvironmentSecret('HUB_SABNZBD_API_KEY');
  settings.hub ??= {};
  if (!settings.hub.prowlarr?.url && !settings.hub.prowlarr?.apiKey) {
    settings.hub.prowlarr = {
      url: process.env.HUB_PROWLARR_URL?.replace(/\/$/, '') ?? '',
      apiKey: prowlarrKey
        ? encryptHubSecret(prowlarrKey, 'prowlarr-api-key')
        : undefined,
    };
  }
  if (!settings.hub.sabnzbd?.url && !settings.hub.sabnzbd?.apiKey) {
    settings.hub.sabnzbd = {
      url: process.env.HUB_SABNZBD_URL?.replace(/\/$/, '') ?? '',
      apiKey: sabnzbdKey
        ? encryptHubSecret(sabnzbdKey, 'sabnzbd-api-key')
        : undefined,
    };
  }
  settings.hub.configurationVersion = 3;
  settings.migrations.push(migrationId);
  return settings;
};

export default migrateHubStatusIntegrations;
