import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import ExternalAPI from './externalapi';

export interface GitHubRelease {
  url: string;
  assets_url: string;
  upload_url: string;
  html_url: string;
  id: number;
  node_id: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  tarball_url: string;
  zipball_url: string;
  body: string;
}

interface GithubCommit {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
    verification: {
      verified: boolean;
      reason: string;
      signature: string;
      payload: string;
    };
  };
  url: string;
  html_url: string;
  comments_url: string;
  parents: [
    {
      sha: string;
      url: string;
      html_url: string;
    },
  ];
}

class GithubAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.github.com',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('github').data,
      }
    );
  }

  public async getProjectReleases({
    take = 20,
  }: {
    take?: number;
  } = {}): Promise<GitHubRelease[]> {
    try {
      const data = await this.get<GitHubRelease[]>(
        '/repos/HapsiellX/paintedclouds-hub/releases',
        {
          params: {
            per_page: take,
          },
        }
      );

      return data.filter((release) => !release.draft);
    } catch (e) {
      logger.warn(
        "Failed to retrieve StefARR releases. The update status can't be checked right now.",
        { label: 'GitHub API', errorMessage: e.message }
      );
      return [];
    }
  }

  public async getProjectCommits({
    take = 20,
    branch = 'main',
  }: {
    take?: number;
    branch?: string;
  } = {}): Promise<GithubCommit[]> {
    try {
      const data = await this.get<GithubCommit[]>(
        '/repos/HapsiellX/paintedclouds-hub/commits',
        {
          params: {
            per_page: take,
            sha: branch,
          },
        }
      );

      return data;
    } catch (e) {
      logger.warn(
        "Failed to retrieve StefARR commits. The development update status can't be checked right now.",
        { label: 'GitHub API', errorMessage: e.message }
      );
      return [];
    }
  }
}

export default GithubAPI;
