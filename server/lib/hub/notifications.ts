import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs';

const webhookUrl = (): string | undefined => {
  if (process.env.HUB_HOME_ASSISTANT_WEBHOOK_URL) {
    return process.env.HUB_HOME_ASSISTANT_WEBHOOK_URL;
  }
  const file = process.env.HUB_HOME_ASSISTANT_WEBHOOK_URL_FILE;
  return file ? fs.readFileSync(file, 'utf8').trim() : undefined;
};

export const notifyHomeAssistant = async (
  event: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const url = webhookUrl();
  if (!url) return;
  try {
    await axios.post(url, { event, ...payload }, { timeout: 5_000 });
  } catch (e) {
    logger.warn('Home Assistant notification failed', {
      label: 'PaintedClouds Hub',
      event,
      errorMessage: e.message,
    });
  }
};
