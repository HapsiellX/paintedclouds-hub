import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatAcquisitionIssueMessage } from './acquisitionIssueMessage';

describe('formatAcquisitionIssueMessage', () => {
  it('localizes every stable acquisition reason code', () => {
    const germanProviderMessage = 'Der Anbieter ist fehlgeschlagen.';
    const expectedEnglish = [
      ['download_failed', 'The download or post-processing failed.'],
      [
        'provider_warning',
        'The media service reported a problem with this download.',
      ],
      ['submission_failed', 'Submission to the media service failed.'],
      [
        'provider_failed',
        'The media service failed or is currently unavailable.',
      ],
    ] as const;

    expectedEnglish.forEach(([reasonCode, expected]) => {
      assert.equal(
        formatAcquisitionIssueMessage(
          { reasonCode, message: germanProviderMessage },
          'en'
        ),
        expected
      );
    });
  });

  it('uses the provider message only for an unknown reason code', () => {
    assert.equal(
      formatAcquisitionIssueMessage(
        { reasonCode: 'unexpected_failure', message: 'Provider detail' },
        'en'
      ),
      'Provider detail'
    );
  });
});
