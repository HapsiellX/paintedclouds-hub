import { decryptHubSecret } from '@server/lib/hub/secrets';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';
import fs from 'fs';

export interface HubServiceStatus {
  id: string;
  name: string;
  healthy: boolean;
  version?: string;
  queueSize?: number;
  error?: string;
}

const readSecret = (name: string): string | undefined => {
  const direct = process.env[name];
  if (direct) return direct;
  const path = process.env[`${name}_FILE`];
  return path ? fs.readFileSync(path, 'utf8').trim() : undefined;
};

export const integrationConfig = (id: string) => {
  const settings = getSettings();
  if (id === 'lidarr') {
    return {
      url: settings.hub.lidarr.url.replace(/\/$/, ''),
      apiKey: decryptHubSecret(settings.hub.lidarr.apiKey, 'lidarr-api-key'),
    };
  }
  if (id === 'lazylibrarian') {
    return {
      url: settings.hub.lazyLibrarian.url.replace(/\/$/, ''),
      apiKey: decryptHubSecret(
        settings.hub.lazyLibrarian.apiKey,
        'lazylibrarian-api-key'
      ),
    };
  }
  if (id === 'radarr' || id === 'sonarr') {
    const service =
      settings[id].find((entry) => entry.isDefault) ?? settings[id][0];
    return service
      ? {
          url: `${service.useSsl ? 'https' : 'http'}://${service.hostname}:${service.port}${service.baseUrl ?? ''}`.replace(
            /\/$/,
            ''
          ),
          apiKey: service.apiKey,
        }
      : { url: undefined, apiKey: undefined };
  }
  const key = id.toUpperCase().replaceAll('-', '_');
  return {
    url: process.env[`HUB_${key}_URL`]?.replace(/\/$/, ''),
    apiKey: readSecret(`HUB_${key}_API_KEY`),
  };
};

const arrStatus = async (
  id: string,
  name: string,
  apiVersion: 'v1' | 'v3',
  includeQueue = true
): Promise<HubServiceStatus> => {
  const { url, apiKey } = integrationConfig(id);
  if (!url || !apiKey) {
    return { id, name, healthy: false, error: 'Nicht konfiguriert' };
  }
  try {
    const client = axios.create({
      baseURL: `${url}/api/${apiVersion}`,
      timeout: 6_000,
      headers: { 'X-Api-Key': apiKey },
    });
    const [status, queue] = await Promise.all([
      client.get('/system/status'),
      includeQueue
        ? client.get('/queue', { params: { page: 1, pageSize: 1 } })
        : Promise.resolve({ data: { totalRecords: 0 } }),
    ]);
    return {
      id,
      name,
      healthy: true,
      version: status.data.version,
      queueSize: queue.data.totalRecords ?? queue.data.records?.length ?? 0,
    };
  } catch (e) {
    return { id, name, healthy: false, error: e.message };
  }
};

const sabStatus = async (): Promise<HubServiceStatus> => {
  const { url, apiKey } = integrationConfig('sabnzbd');
  if (!url || !apiKey) {
    return {
      id: 'sabnzbd',
      name: 'SABnzbd',
      healthy: false,
      error: 'Nicht konfiguriert',
    };
  }
  try {
    const response = await axios.get(`${url}/api`, {
      timeout: 6_000,
      params: { mode: 'queue', output: 'json', apikey: apiKey },
    });
    return {
      id: 'sabnzbd',
      name: 'SABnzbd',
      healthy: true,
      version: response.data.queue?.version,
      queueSize: Number(response.data.queue?.noofslots ?? 0),
    };
  } catch (e) {
    return { id: 'sabnzbd', name: 'SABnzbd', healthy: false, error: e.message };
  }
};

export const getHubServiceStatus = async (): Promise<HubServiceStatus[]> =>
  Promise.all([
    arrStatus('sonarr', 'Sonarr', 'v3'),
    arrStatus('radarr', 'Radarr', 'v3'),
    arrStatus('lidarr', 'Lidarr', 'v1'),
    arrStatus('prowlarr', 'Prowlarr', 'v1', false),
    sabStatus(),
  ]);

export const getStorageUsage = async (): Promise<{
  usedPercent?: number;
  freeBytes?: number;
}> => {
  const { url, apiKey } = integrationConfig('sonarr');
  if (!url || !apiKey) return {};
  try {
    const response = await axios.get(`${url}/api/v3/diskspace`, {
      timeout: 6_000,
      headers: { 'X-Api-Key': apiKey },
    });
    const disks = response.data as {
      path: string;
      freeSpace: number;
      totalSpace: number;
    }[];
    const media = disks.find((disk) => disk.path === '/tv') ?? disks[0];
    if (!media?.totalSpace) return {};
    return {
      usedPercent: Math.round(
        ((media.totalSpace - media.freeSpace) / media.totalSpace) * 100
      ),
      freeBytes: media.freeSpace,
    };
  } catch {
    return {};
  }
};
