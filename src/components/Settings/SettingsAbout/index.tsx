import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import List from '@app/components/Common/List';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Releases from '@app/components/Settings/SettingsAbout/Releases';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  SettingsAboutResponse,
  StatusResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsAbout', {
  about: 'About',
  aboutseerr: 'About StefARR by PaintedClouds',
  version: 'Version',
  totalmedia: 'Total Media',
  totalrequests: 'Total Requests',
  gettingsupport: 'Getting Support',
  githubdiscussions: 'GitHub Discussions',
  timezone: 'Time Zone',
  appDataPath: 'Data Directory',
  supportseerr: 'Contribute to StefARR',
  contribute: 'Make a Contribution',
  documentation: 'Documentation',
  outofdate: 'Out of Date',
  uptodate: 'Up to Date',
  runningDevelop:
    'You are running a development build of StefARR. Use it only for development or release testing.',
  lineage: 'Open-source lineage',
  lineageFoundation: 'Project foundation',
  lineageFoundationDescription:
    'StefARR is an independent PaintedClouds project built from the open-source Seerr project.',
  seerrProject: 'Visit the Seerr project',
  licensing: 'Licenses and attribution',
  projectLicense: 'StefARR license',
  attribution: 'Upstream attribution',
  independence: 'Independent project',
  independenceDescription:
    'StefARR is not affiliated with or endorsed by the Seerr team. Product names and trademarks belong to their respective owners.',
});

const SettingsAbout = () => {
  const intl = useIntl();
  const { data, error } = useSWR<SettingsAboutResponse>(
    '/api/v1/settings/about'
  );

  const { data: status } = useSWR<StatusResponse>('/api/v1/status');

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.about),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="section">
        <List title={intl.formatMessage(messages.aboutseerr)}>
          {data.version.startsWith('develop-') && (
            <Alert
              title={intl.formatMessage(messages.runningDevelop, {
                code: (msg: React.ReactNode) => (
                  <code className="bg-gray-800/50">{msg}</code>
                ),
              })}
            />
          )}
          <List.Item
            title={intl.formatMessage(messages.version)}
            className="flex flex-row items-center truncate"
          >
            <code className="truncate">
              {data.version.replace('develop-', '')}
            </code>
            {status?.commitTag !== 'local' &&
              (status?.updateAvailable ? (
                <a
                  href={
                    data.version.startsWith('develop-')
                      ? `https://github.com/HapsiellX/paintedclouds-hub/compare/${status.commitTag}...main`
                      : 'https://github.com/HapsiellX/paintedclouds-hub/releases'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Badge
                    badgeType="warning"
                    className="ml-2 !cursor-pointer transition hover:bg-yellow-400"
                  >
                    {intl.formatMessage(messages.outofdate)}
                  </Badge>
                </a>
              ) : (
                <a
                  href={
                    data.version.startsWith('develop-')
                      ? 'https://github.com/HapsiellX/paintedclouds-hub/commits/main'
                      : 'https://github.com/HapsiellX/paintedclouds-hub/releases'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Badge
                    badgeType="success"
                    className="ml-2 !cursor-pointer transition hover:bg-green-400"
                  >
                    {intl.formatMessage(messages.uptodate)}
                  </Badge>
                </a>
              ))}
          </List.Item>
          <List.Item title={intl.formatMessage(messages.totalmedia)}>
            {intl.formatNumber(data.totalMediaItems)}
          </List.Item>
          <List.Item title={intl.formatMessage(messages.totalrequests)}>
            {intl.formatNumber(data.totalRequests)}
          </List.Item>
          <List.Item title={intl.formatMessage(messages.appDataPath)}>
            <code>{data.appDataPath}</code>
          </List.Item>
          {data.tz && (
            <List.Item title={intl.formatMessage(messages.timezone)}>
              <code>{data.tz}</code>
            </List.Item>
          )}
        </List>
      </div>
      <div className="section">
        <List title={intl.formatMessage(messages.lineage)}>
          <List.Item title={intl.formatMessage(messages.lineageFoundation)}>
            <div className="max-w-2xl text-right">
              <p>{intl.formatMessage(messages.lineageFoundationDescription)}</p>
              <a
                href="https://github.com/seerr-team/seerr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 transition duration-300 hover:underline"
              >
                {intl.formatMessage(messages.seerrProject)}
              </a>
            </div>
          </List.Item>
          <List.Item title={intl.formatMessage(messages.licensing)}>
            <div className="flex flex-col items-end gap-1">
              <a
                href="https://github.com/HapsiellX/paintedclouds-hub/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 transition duration-300 hover:underline"
              >
                {intl.formatMessage(messages.projectLicense)}
              </a>
              <a
                href="https://github.com/HapsiellX/paintedclouds-hub/blob/main/ATTRIBUTION.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 transition duration-300 hover:underline"
              >
                {intl.formatMessage(messages.attribution)}
              </a>
            </div>
          </List.Item>
          <List.Item title={intl.formatMessage(messages.independence)}>
            <p className="max-w-2xl text-right">
              {intl.formatMessage(messages.independenceDescription)}
            </p>
          </List.Item>
        </List>
      </div>
      <div className="section">
        <List title={intl.formatMessage(messages.gettingsupport)}>
          <List.Item title={intl.formatMessage(messages.documentation)}>
            <a
              href="https://github.com/HapsiellX/paintedclouds-hub/tree/main/docs"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-500 transition duration-300 hover:underline"
            >
              Project documentation
            </a>
          </List.Item>
          <List.Item title={intl.formatMessage(messages.githubdiscussions)}>
            <a
              href="https://github.com/HapsiellX/paintedclouds-hub/discussions"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-500 transition duration-300 hover:underline"
            >
              GitHub Discussions
            </a>
          </List.Item>
          <List.Item title="GitHub Issues">
            <a
              href="https://github.com/HapsiellX/paintedclouds-hub/issues"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-500 transition duration-300 hover:underline"
            >
              Report a bug or request a feature
            </a>
          </List.Item>
        </List>
      </div>
      <div className="section">
        <List title={intl.formatMessage(messages.supportseerr)}>
          <List.Item title={intl.formatMessage(messages.contribute)}>
            <a
              href="https://github.com/HapsiellX/paintedclouds-hub/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-500 transition duration-300 hover:underline"
            >
              Contribution guide
            </a>
          </List.Item>
        </List>
      </div>
      <div className="section">
        <Releases currentVersion={data.version} />
      </div>
    </>
  );
};

export default SettingsAbout;
