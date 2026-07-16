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

after(() => {
  delete process.env.HUB_LIDARR_URL;
  delete process.env.HUB_LIDARR_API_KEY;
  delete process.env.HUB_METADATA_CONTACT_EMAIL;
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
});
