import { scheduledJobs } from '@server/job/schedule';
import { decryptHubSecret, encryptHubSecret } from '@server/lib/hub/secrets';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';
import { Router } from 'express';
import { rescheduleJob } from 'node-schedule';
import { z } from 'zod';

const hubSettingsRoutes = Router();

const safeServiceUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !hostname.endsWith('.internal') &&
      hostname !== 'metadata.google.internal' &&
      hostname !== '169.254.169.254' &&
      !hostname.startsWith('169.254.') &&
      !hostname.startsWith('fe80:') &&
      !hostname.startsWith('::ffff:169.254.') &&
      !hostname.startsWith('::ffff:a9fe:')
    );
  }, 'Unsafe service URL.');
const optionalUrl = z.union([z.literal(''), safeServiceUrl]);
const schema = z
  .object({
    enabled: z.boolean(),
    lidarr: z.object({
      url: optionalUrl,
      apiKey: z.string().max(1000).optional(),
      clearApiKey: z.boolean().optional(),
      rootFolder: z.string().trim().min(1).max(1000),
      qualityProfileId: z.number().int().nonnegative(),
      metadataProfileId: z.number().int().nonnegative(),
    }),
    lazyLibrarian: z.object({
      url: optionalUrl,
      apiKey: z.string().max(1000).optional(),
      clearApiKey: z.boolean().optional(),
    }),
    prowlarr: z.object({
      url: optionalUrl,
      apiKey: z.string().max(1000).optional(),
      clearApiKey: z.boolean().optional(),
    }),
    sabnzbd: z.object({
      url: optionalUrl,
      apiKey: z.string().max(1000).optional(),
      clearApiKey: z.boolean().optional(),
    }),
    homeAssistant: z.object({
      webhookUrl: safeServiceUrl.optional(),
      clearWebhookUrl: z.boolean().optional(),
    }),
    metadata: z.object({
      contactEmail: z.union([z.literal(''), z.string().email().max(320)]),
      userAgent: z.string().max(500),
    }),
    defaults: z.object({
      languages: z
        .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/))
        .min(1)
        .max(5),
      bookFormats: z
        .array(z.enum(['ebook', 'audiobook']))
        .min(1)
        .max(2),
    }),
    quota: z.object({
      enabled: z.boolean(),
      defaultPoints: z.number().int().min(0).max(10000),
      windowDays: z.number().int().min(1).max(365),
      weights: z.record(z.string(), z.number().int().min(1).max(100)),
    }),
    sync: z.object({ intervalMinutes: z.number().int().min(1).max(60) }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && !value.metadata.contactEmail) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'contactEmail'],
        message: 'A project contact email is required for metadata providers.',
      });
    }
  });

const publicSettings = () => {
  const hub = getSettings().hub;
  return {
    ...hub,
    lidarr: {
      ...hub.lidarr,
      apiKey: undefined,
      apiKeyConfigured: Boolean(hub.lidarr.apiKey),
    },
    lazyLibrarian: {
      ...hub.lazyLibrarian,
      apiKey: undefined,
      apiKeyConfigured: Boolean(hub.lazyLibrarian.apiKey),
    },
    prowlarr: {
      ...hub.prowlarr,
      apiKey: undefined,
      apiKeyConfigured: Boolean(hub.prowlarr.apiKey),
    },
    sabnzbd: {
      ...hub.sabnzbd,
      apiKey: undefined,
      apiKeyConfigured: Boolean(hub.sabnzbd.apiKey),
    },
    homeAssistant: {
      webhookUrlConfigured: Boolean(hub.homeAssistant.webhookUrl),
    },
  };
};

hubSettingsRoutes.get('/', (_req, res) => res.json(publicSettings()));

hubSettingsRoutes.put('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: 'Invalid Hub settings.', issues: parsed.error.issues });
  }
  const settings = getSettings();
  const next = parsed.data;
  const {
    apiKey: lidarrApiKey,
    clearApiKey: clearLidarrApiKey,
    ...lidarr
  } = next.lidarr;
  const {
    apiKey: lazyLibrarianApiKey,
    clearApiKey: clearLazyLibrarianApiKey,
    ...lazyLibrarian
  } = next.lazyLibrarian;
  const {
    apiKey: prowlarrApiKey,
    clearApiKey: clearProwlarrApiKey,
    ...prowlarr
  } = next.prowlarr;
  const {
    apiKey: sabnzbdApiKey,
    clearApiKey: clearSabnzbdApiKey,
    ...sabnzbd
  } = next.sabnzbd;
  settings.hub = {
    ...settings.hub,
    ...next,
    configurationVersion: 3,
    environmentImported: settings.hub.environmentImported,
    lidarr: {
      ...lidarr,
      apiKey: clearLidarrApiKey
        ? undefined
        : lidarrApiKey
          ? encryptHubSecret(lidarrApiKey, 'lidarr-api-key')
          : settings.hub.lidarr.apiKey,
    },
    lazyLibrarian: {
      ...lazyLibrarian,
      apiKey: clearLazyLibrarianApiKey
        ? undefined
        : lazyLibrarianApiKey
          ? encryptHubSecret(lazyLibrarianApiKey, 'lazylibrarian-api-key')
          : settings.hub.lazyLibrarian.apiKey,
    },
    prowlarr: {
      ...prowlarr,
      apiKey: clearProwlarrApiKey
        ? undefined
        : prowlarrApiKey
          ? encryptHubSecret(prowlarrApiKey, 'prowlarr-api-key')
          : settings.hub.prowlarr.apiKey,
    },
    sabnzbd: {
      ...sabnzbd,
      apiKey: clearSabnzbdApiKey
        ? undefined
        : sabnzbdApiKey
          ? encryptHubSecret(sabnzbdApiKey, 'sabnzbd-api-key')
          : settings.hub.sabnzbd.apiKey,
    },
    homeAssistant: {
      webhookUrl: next.homeAssistant.clearWebhookUrl
        ? undefined
        : next.homeAssistant.webhookUrl
          ? encryptHubSecret(
              next.homeAssistant.webhookUrl,
              'home-assistant-webhook'
            )
          : settings.hub.homeAssistant.webhookUrl,
    },
  };
  const reconciliationSchedule = `0 */${next.sync.intervalMinutes} * * * *`;
  settings.jobs['hub-reconciliation'].schedule = reconciliationSchedule;
  const reconciliationJob = scheduledJobs.find(
    (job) => job.id === 'hub-reconciliation'
  );
  if (reconciliationJob) {
    rescheduleJob(reconciliationJob.job, reconciliationSchedule);
    reconciliationJob.cronSchedule = reconciliationSchedule;
  }
  await settings.save();
  return res.json(publicSettings());
});

hubSettingsRoutes.post('/test/:service', async (req, res) => {
  const settings = getSettings().hub;
  const service = z
    .enum(['lidarr', 'lazylibrarian', 'prowlarr', 'sabnzbd'])
    .safeParse(req.params.service);
  if (!service.success)
    return res.status(404).json({ message: 'Unknown service.' });
  const selected =
    settings[service.data === 'lazylibrarian' ? 'lazyLibrarian' : service.data];
  if (!selected.url || !selected.apiKey) {
    return res
      .status(400)
      .json({ message: 'Service URL and API key are required.' });
  }
  const purpose = `${service.data}-api-key`;
  try {
    const response = await axios.get(
      service.data === 'lidarr' || service.data === 'prowlarr'
        ? `${selected.url.replace(/\/$/, '')}/api/v1/system/status`
        : `${selected.url.replace(/\/$/, '')}/api`,
      {
        timeout: 10_000,
        maxRedirects: 0,
        headers:
          service.data === 'lidarr' || service.data === 'prowlarr'
            ? { 'X-Api-Key': decryptHubSecret(selected.apiKey, purpose) }
            : undefined,
        params:
          service.data === 'lazylibrarian'
            ? {
                cmd: 'getVersion',
                apikey: decryptHubSecret(selected.apiKey, purpose),
              }
            : service.data === 'sabnzbd'
              ? {
                  mode: 'version',
                  output: 'json',
                  apikey: decryptHubSecret(selected.apiKey, purpose),
                }
              : undefined,
      }
    );
    return res.json({
      healthy: response.status >= 200 && response.status < 300,
    });
  } catch {
    return res
      .status(502)
      .json({ healthy: false, message: 'Connection test failed.' });
  }
});

export default hubSettingsRoutes;
