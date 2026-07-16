import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'paintedclouds-secrets-')
);
process.env.CONFIG_DIRECTORY = directory;

after(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('PaintedClouds Hub secret storage', () => {
  it('encrypts with authenticated associated data and a private key file', async () => {
    const { decryptHubSecret, encryptHubSecret, hubSecretKeyPath } =
      await import('./secrets');
    const encrypted = encryptHubSecret('very-secret', 'test-purpose');
    assert.notEqual(encrypted.encrypted, 'very-secret');
    assert.equal(decryptHubSecret(encrypted, 'test-purpose'), 'very-secret');
    assert.equal(fs.statSync(hubSecretKeyPath).mode & 0o777, 0o600);
    assert.throws(() => decryptHubSecret(encrypted, 'other-purpose'));
    assert.throws(() =>
      decryptHubSecret(
        { ...encrypted, encrypted: Buffer.from('tampered').toString('base64') },
        'test-purpose'
      )
    );
  });
});
