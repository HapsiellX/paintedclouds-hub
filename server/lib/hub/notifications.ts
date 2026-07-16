import { decryptHubSecret } from '@server/lib/hub/secrets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';

const webhookUrl = (): string | undefined => {
  return decryptHubSecret(
    getSettings().hub.homeAssistant.webhookUrl,
    'home-assistant-webhook'
  );
};

export const notifyHomeAssistant = async (
  event: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const url = webhookUrl();
  if (!url) return;
  try {
    await axios.post(
      url,
      { event, ...payload },
      {
        timeout: 5_000,
        maxRedirects: 0,
      }
    );
  } catch (e) {
    logger.warn('Home Assistant notification failed', {
      label: 'PaintedClouds Hub',
      event,
      errorMessage: e.message,
    });
  }
};
