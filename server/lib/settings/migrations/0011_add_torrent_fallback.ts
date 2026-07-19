import type { AllSettings } from '@server/lib/settings';

const migrationId = '0011_add_torrent_fallback';

const addTorrentFallback = (settings: any): AllSettings => {
  settings.migrations ??= [];
  if (settings.migrations.includes(migrationId)) return settings;
  settings.hub ??= {};
  settings.hub.torrentFallback ??= {
    enabled: false,
    vpnGateUrl: '',
    allowedExitCountries: ['DK'],
    minSeeders: 2,
    retryCooldownMinutes: 30,
  };
  settings.hub.configurationVersion = 4;
  settings.migrations.push(migrationId);
  return settings;
};

export default addTorrentFallback;
