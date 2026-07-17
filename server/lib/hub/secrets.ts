import type { HubSecretValue } from '@server/lib/settings';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const configDirectory =
  process.env.CONFIG_DIRECTORY ?? path.join(process.cwd(), 'config');
const keyPath = path.join(configDirectory, 'hub-secrets.key');

let cachedKey: Buffer | undefined;

const loadKey = (create: boolean): Buffer => {
  if (cachedKey) return cachedKey;
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  try {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) {
      throw new Error(
        'hub-secrets.key is missing; restore it from the matching backup.'
      );
    }
    const key = randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('base64'), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    cachedKey = key;
  }
  if (cachedKey.length !== 32) {
    throw new Error('The StefARR secrets key is invalid.');
  }
  fs.chmodSync(keyPath, 0o600);
  return cachedKey;
};

export const encryptHubSecret = (
  plaintext: string,
  purpose: string
): HubSecretValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(true), iv);
  cipher.setAAD(Buffer.from(`paintedclouds-hub:${purpose}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  };
};

export const decryptHubSecret = (
  value: HubSecretValue | undefined,
  purpose: string
): string | undefined => {
  if (!value) return undefined;
  if (value.version !== 1) throw new Error('Unsupported Hub secret version.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    loadKey(false),
    Buffer.from(value.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(`paintedclouds-hub:${purpose}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

export const validateHubSecrets = (values: {
  lidarr?: HubSecretValue;
  lazyLibrarian?: HubSecretValue;
  prowlarr?: HubSecretValue;
  sabnzbd?: HubSecretValue;
  homeAssistant?: HubSecretValue;
}): void => {
  if (values.lidarr) decryptHubSecret(values.lidarr, 'lidarr-api-key');
  if (values.lazyLibrarian) {
    decryptHubSecret(values.lazyLibrarian, 'lazylibrarian-api-key');
  }
  if (values.prowlarr) decryptHubSecret(values.prowlarr, 'prowlarr-api-key');
  if (values.sabnzbd) decryptHubSecret(values.sabnzbd, 'sabnzbd-api-key');
  if (values.homeAssistant) {
    decryptHubSecret(values.homeAssistant, 'home-assistant-webhook');
  }
};

export const hubSecretKeyPath = keyPath;
