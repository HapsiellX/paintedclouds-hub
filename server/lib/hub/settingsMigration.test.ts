import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-v01-import-'));
process.env.CONFIG_DIRECTORY = directory;
process.env.HUB_LIDARR_URL = 'http://lidarr:8686';
process.env.HUB_LIDARR_API_KEY = 'legacy-lidarr-secret';
process.env.HUB_METADATA_CONTACT_EMAIL = 'hub@example.test';
process.env.HUB_PROWLARR_URL = 'http://prowlarr:9696';
process.env.HUB_PROWLARR_API_KEY = 'legacy-prowlarr-secret';
process.env.HUB_SABNZBD_URL = 'http://sabnzbd:8080';
process.env.HUB_SABNZBD_API_KEY = 'legacy-sabnzbd-secret';

after(() => {
  delete process.env.HUB_LIDARR_URL;
  delete process.env.HUB_LIDARR_API_KEY;
  delete process.env.HUB_METADATA_CONTACT_EMAIL;
  delete process.env.HUB_PROWLARR_URL;
  delete process.env.HUB_PROWLARR_API_KEY;
  delete process.env.HUB_SABNZBD_URL;
  delete process.env.HUB_SABNZBD_API_KEY;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('PaintedClouds Hub V0.1 settings import', () => {
  it('imports legacy environment values once without storing plaintext secrets', async () => {
    const migrate = (
      await import('@server/lib/settings/migrations/0009_migrate_hub_settings')
    ).default;
    const { decryptHubSecret } = await import('@server/lib/hub/secrets');
    const input = { migrations: [] } as never;
    const migrated = migrate(input);
    assert.equal(migrated.hub.environmentImported, true);
    assert.equal(migrated.hub.lidarr.url, 'http://lidarr:8686');
    assert.ok(!JSON.stringify(migrated).includes('legacy-lidarr-secret'));
    assert.equal(
      decryptHubSecret(migrated.hub.lidarr.apiKey, 'lidarr-api-key'),
      'legacy-lidarr-secret'
    );
    assert.deepEqual(migrate(structuredClone(migrated)), migrated);
  });

  it('imports V0.2 status integrations into encrypted V0.3 settings once', async () => {
    const migrateV02 = (
      await import('@server/lib/settings/migrations/0010_migrate_hub_status_integrations')
    ).default;
    const { decryptHubSecret } = await import('@server/lib/hub/secrets');
    const input = {
      migrations: [],
      hub: { configurationVersion: 2 },
    } as never;
    const migrated = migrateV02(input);
    assert.equal(migrated.hub.configurationVersion, 3);
    assert.equal(migrated.hub.prowlarr.url, 'http://prowlarr:9696');
    assert.equal(migrated.hub.sabnzbd.url, 'http://sabnzbd:8080');
    assert.ok(!JSON.stringify(migrated).includes('legacy-prowlarr-secret'));
    assert.ok(!JSON.stringify(migrated).includes('legacy-sabnzbd-secret'));
    assert.equal(
      decryptHubSecret(migrated.hub.prowlarr.apiKey, 'prowlarr-api-key'),
      'legacy-prowlarr-secret'
    );
    assert.equal(
      decryptHubSecret(migrated.hub.sabnzbd.apiKey, 'sabnzbd-api-key'),
      'legacy-sabnzbd-secret'
    );
    assert.deepEqual(migrateV02(structuredClone(migrated)), migrated);
  });

  it('adds a disabled fail-closed torrent fallback to existing settings', async () => {
    const migrate = (
      await import('@server/lib/settings/migrations/0011_add_torrent_fallback')
    ).default;
    const input = {
      migrations: [],
      hub: { configurationVersion: 3 },
    } as never;
    const migrated = migrate(input);
    assert.equal(migrated.hub.configurationVersion, 4);
    assert.equal(migrated.hub.torrentFallback.enabled, false);
    assert.deepEqual(migrated.hub.torrentFallback.allowedExitCountries, ['DK']);
    assert.deepEqual(migrate(structuredClone(migrated)), migrated);
  });
});
