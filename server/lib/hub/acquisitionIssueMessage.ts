export interface AcquisitionIssueMessageInput {
  reasonCode: string;
  message: string;
}

const issueMessages: Record<string, { de: string; en: string }> = {
  download_failed: {
    de: 'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
    en: 'The download or post-processing failed.',
  },
  provider_warning: {
    de: 'Der Mediendienst meldete ein Problem mit diesem Download.',
    en: 'The media service reported a problem with this download.',
  },
  submission_failed: {
    de: 'Die Übermittlung an den Mediendienst ist fehlgeschlagen.',
    en: 'Submission to the media service failed.',
  },
  provider_failed: {
    de: 'Der Mediendienst ist fehlgeschlagen oder derzeit nicht erreichbar.',
    en: 'The media service failed or is currently unavailable.',
  },
};

export const formatAcquisitionIssueMessage = (
  issue: AcquisitionIssueMessageInput,
  locale: string
): string =>
  issueMessages[issue.reasonCode]?.[locale === 'de' ? 'de' : 'en'] ??
  issue.message;
