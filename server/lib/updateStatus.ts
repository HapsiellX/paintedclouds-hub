import type { GitHubRelease } from '@server/api/github';
import semver from 'semver';

export const isReleaseUpdateAvailable = (
  currentVersion: string,
  releases: Pick<GitHubRelease, 'tag_name' | 'prerelease' | 'draft'>[]
): boolean => {
  const current = semver.parse(currentVersion.replace(/^v/, ''));
  if (!current) return false;
  const allowPrerelease = current.prerelease.length > 0;
  const latest = releases
    .filter((release) => !release.draft)
    .map((release) => ({
      release,
      version: semver.parse(release.tag_name.replace(/^v/, '')),
    }))
    .filter(
      (
        entry
      ): entry is {
        release: (typeof releases)[number];
        version: semver.SemVer;
      } =>
        Boolean(entry.version) && (allowPrerelease || !entry.release.prerelease)
    )
    .map((entry) => entry.version)
    .sort(semver.rcompare)[0];
  return Boolean(latest && semver.gt(latest, current));
};
