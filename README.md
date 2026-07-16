# PaintedClouds Hub

![PaintedClouds Hub cross-media artwork](./public/images/paintedclouds-hub-hero-v0.3.webp)

PaintedClouds Hub is an independent, open-source media request and discovery
manager for self-hosted libraries. It extends the movie and television
workflows inherited from [Seerr](https://github.com/seerr-team/seerr) with
music, e-book, and audiobook discovery and request workflows.

> [!IMPORTANT]
> Back up the configuration directory and database before every upgrade. Use
> only a signed release image and a migration path explicitly listed in its
> release notes.

PaintedClouds Hub is an independent fork. It is not affiliated with, endorsed
by, or supported by the Seerr project or its maintainers. Please report
PaintedClouds Hub problems here, not to Seerr's support channels.

## What It Does

- Discovers and requests movies and television through the established Seerr,
  Radarr, and Sonarr workflows.
- Discovers artists and albums with MusicBrainz and Cover Art Archive metadata,
  then submits music requests to Lidarr.
- Discovers books with Open Library metadata, then submits e-book and audiobook
  requests to LazyLibrarian.
- Provides a unified request overview, weighted request policy, audit events,
  service health information, and optional Home Assistant webhook events.
- Supports Jellyfin, Plex, and Emby authentication inherited from Seerr.
- Supports SQLite and PostgreSQL.

## V0.3 Supported Scope

- Music and book requests use canonical MusicBrainz and Open Library identities.
  Books with multiple editions require an explicit edition selection.
- Lidarr and LazyLibrarian states are reconciled into a normalized request
  lifecycle. Temporary downstream failures preserve the last known good state.
- Non-administrator auto-approval is opt-in and protected by a transactional,
  rolling points ledger on SQLite and PostgreSQL.
- Core Hub administration, activity, discovery, detail and request workflows
  are supported in English and German.
- The application home, global search, navigation and release information now
  use one cross-media PaintedClouds workflow and the official project GitHub
  repository.
- Prowlarr and SABnzbd health integrations are configured and encrypted in the
  Admin UI; legacy runtime key mounts can be removed after the V0.3 migration.
- Request approval, retry and decline transitions reject stale or concurrent
  actions, and credentialed integration calls never follow redirects.
- Personalization, AI recommendations, Readarr and additional acquisition
  backends are not part of V0.2.
- External metadata and cover services may return incomplete results, throttle
  requests, or be unavailable.
- Migration and rollback compatibility is guaranteed only where a release note
  explicitly says so.

See [ROADMAP.md](./ROADMAP.md) for planned work. Roadmap items are not promises.

## Installation

Published releases should be installed only from the exact container
image and digest listed in that release's notes. Do not assume an unversioned
`latest` image is safe to deploy.

Before installation:

1. Back up the complete application configuration directory and database.
2. Read the release notes and verify that your source version and database are
   supported.
3. Prepare Jellyfin, Plex, or Emby and the acquisition services you intend to
   use.
4. Configure integration credentials in the authenticated Hub Admin UI.
5. Place the application behind HTTPS when it is reachable outside a trusted
   network.

The application listens on port `5055` and requires a persistent configuration
directory at `/app/config` in the container. The exact image reference, digest,
supported architectures, and tested Compose example belong to each release.

For source development, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Hub Configuration

Configure Hub integrations under **Settings → PaintedClouds Hub**. API keys and
the optional Home Assistant webhook are encrypted with AES-256-GCM and are
never returned by the API. Back up both `settings.json` and
`hub-secrets.key`; without the latter the encrypted values cannot be recovered.

On the first V0.2 start, existing V0.1 `HUB_*` environment variables or secret
files are imported once. The Admin UI is authoritative afterwards, so remove
the legacy variables after validating the import. Use a monitored role-based
contact address for metadata providers; that address is disclosed to
MusicBrainz and Open Library as part of responsible client identification.

On the first V0.3 start, existing Prowlarr and SABnzbd `HUB_*` values are
imported into the same encrypted Admin UI. Validate both connection tests and
then remove those final compatibility variables and secret mounts.

Do not publish logs, Compose files, screenshots, or issue reports containing API
keys, webhook URLs, database credentials, session cookies, or private hostnames.

## Upgrading and Rollback

1. Stop the application and take a consistent database and configuration
   backup.
2. Read all release notes between the installed and target versions.
3. For V0.1 upgrades, preserve legacy `HUB_*` values for the first V0.2 start
   so they can be imported exactly once.
4. Pull the exact version or digest, then start one application instance and
   allow migrations to finish.
5. Verify login, discovery, request creation, quota status, reconciliation and
   downstream service access
   before removing the backup.

Database downgrades are not supported. Rollback means restoring both the old
image and the matching pre-upgrade database/configuration backup.

## Security, Privacy, and Support

- Report vulnerabilities according to [SECURITY.md](./SECURITY.md).
- Review external data flows in [PRIVACY.md](./PRIVACY.md).
- Get help and learn the support boundaries in [SUPPORT.md](./SUPPORT.md).
- Community participation is governed by
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) and
  [GOVERNANCE.md](./GOVERNANCE.md).

## Data Sources and Attribution

PaintedClouds Hub uses metadata or artwork from services including TMDB,
MusicBrainz, Cover Art Archive, and Open Library. Their data, artwork, names,
and trademarks are not relicensed under PaintedClouds Hub's software license.
See [ATTRIBUTION.md](./ATTRIBUTION.md) for source, license, and usage notices.

## License

PaintedClouds Hub is distributed under the MIT License. The original copyright
and license notice are preserved in [LICENSE](./LICENSE). See
[ATTRIBUTION.md](./ATTRIBUTION.md) for the upstream lineage and third-party
notices.
