import type { AllSettings } from '@server/lib/settings';
import {
  DEFAULT_APPLICATION_TITLE,
  migrateLegacyBrandDefaults,
} from '@server/lib/settings';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const brandSettings = (applicationTitle: string, senderName: string) =>
  ({
    main: { applicationTitle },
    notifications: {
      agents: { email: { options: { senderName } } },
    },
  }) as Pick<AllSettings, 'main' | 'notifications'>;

describe('StefARR settings brand migration', () => {
  it('migrates the former Seerr defaults idempotently', () => {
    const settings = brandSettings('Seerr', 'Seerr');

    assert.equal(migrateLegacyBrandDefaults(settings), true);
    assert.equal(settings.main.applicationTitle, DEFAULT_APPLICATION_TITLE);
    assert.equal(
      settings.notifications.agents.email.options.senderName,
      DEFAULT_APPLICATION_TITLE
    );
    assert.equal(migrateLegacyBrandDefaults(settings), false);
  });

  it('migrates the former PaintedClouds Hub defaults', () => {
    const settings = brandSettings('PaintedClouds Hub', 'PaintedClouds Hub');

    assert.equal(migrateLegacyBrandDefaults(settings), true);
    assert.equal(settings.main.applicationTitle, DEFAULT_APPLICATION_TITLE);
    assert.equal(
      settings.notifications.agents.email.options.senderName,
      DEFAULT_APPLICATION_TITLE
    );
  });

  it('preserves administrator-defined instance and sender names', () => {
    const settings = brandSettings('Family Cinema', 'Media Team');

    assert.equal(migrateLegacyBrandDefaults(settings), false);
    assert.equal(settings.main.applicationTitle, 'Family Cinema');
    assert.equal(
      settings.notifications.agents.email.options.senderName,
      'Media Team'
    );
  });
});
