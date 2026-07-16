# PaintedClouds Hub

PaintedClouds Hub is an independent, open-source media request and discovery
manager for self-hosted libraries. It extends the movie and television
workflows inherited from [Seerr](https://github.com/seerr-team/seerr) with
music, e-book, and audiobook discovery and request workflows.

> [!CAUTION]
> PaintedClouds Hub is alpha software. Back up your configuration and database
> before installing or upgrading. Interfaces, configuration, and database
> migrations may change before the first stable release.

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

## Alpha Limitations

- Book matching is title-based and may select the wrong work, edition,
  language, or audiobook variant. Confirm the result in LazyLibrarian.
- Requests from non-administrators always require manual approval in the first
  alpha release. Automatic quota-based approval is intentionally disabled until
  reservations are transactional on both SQLite and PostgreSQL.
- Music and book acquisition state is not yet fully synchronized back from all
  downstream services.
- Some Hub policy values, default languages, storage assumptions, and discovery
  shelves are not yet configurable.
- Hub-specific user interface text is currently primarily German.
- External metadata and cover services may return incomplete results, throttle
  requests, or be unavailable.
- Migration and rollback compatibility is guaranteed only where a release note
  explicitly says so.

See [ROADMAP.md](./ROADMAP.md) for planned work. Roadmap items are not promises.

## Installation

Published alpha releases should be installed only from the exact container
image and digest listed in that release's notes. Do not assume an unversioned
`latest` image is safe to deploy.

Before installation:

1. Back up the complete application configuration directory and database.
2. Read the release notes and verify that your source version and database are
   supported.
3. Prepare Jellyfin, Plex, or Emby and the acquisition services you intend to
   use.
4. Keep API keys in container secrets or files mounted read-only; prefer the
   supported `*_FILE` variables.
5. Place the application behind HTTPS when it is reachable outside a trusted
   network.

The application listens on port `5055` and requires a persistent configuration
directory at `/app/config` in the container. The exact image reference, digest,
supported architectures, and tested Compose example belong to each release.

For source development, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Hub Configuration

The base Seerr configuration remains available through the application setup
and settings screens. Hub integrations currently use environment variables.

| Variable | Purpose | Required |
| --- | --- | --- |
| `HUB_LIDARR_URL` | Base URL of Lidarr | For music requests |
| `HUB_LIDARR_API_KEY` or `HUB_LIDARR_API_KEY_FILE` | Lidarr API key | For music requests |
| `HUB_LIDARR_ROOT` | Lidarr music root; defaults to `/music` | No |
| `HUB_LIDARR_QUALITY_PROFILE_ID` | Positive Lidarr quality profile ID | For music requests |
| `HUB_LIDARR_METADATA_PROFILE_ID` | Positive Lidarr metadata profile ID | For music requests |
| `HUB_LAZYLIBRARIAN_URL` | Base URL of LazyLibrarian | For book requests |
| `HUB_LAZYLIBRARIAN_API_KEY` or `HUB_LAZYLIBRARIAN_API_KEY_FILE` | LazyLibrarian API key | For book requests |
| `HUB_SONARR_URL`, `HUB_RADARR_URL`, `HUB_PROWLARR_URL`, `HUB_SABNZBD_URL` | Optional service-health endpoints | No |
| Corresponding `HUB_*_API_KEY` or `HUB_*_API_KEY_FILE` | API keys for optional health checks | No |
| `HUB_HOME_ASSISTANT_WEBHOOK_URL` or `HUB_HOME_ASSISTANT_WEBHOOK_URL_FILE` | Optional Home Assistant webhook | No |
| `HUB_METADATA_CONTACT_EMAIL` | Contact identifier sent to MusicBrainz in the User-Agent and to Open Library as its `email` request parameter | Required for an identified metadata client |
| `HUB_METADATA_USER_AGENT` | Explicitly overrides the metadata-client User-Agent; it must still identify the application and provide a valid contact | No |

Use a monitored, role-based project or instance contact address for
`HUB_METADATA_CONTACT_EMAIL`, not a maintainer's private address. Setting it
causes that value to be disclosed to MusicBrainz and Open Library on metadata
requests. `HUB_METADATA_USER_AGENT` is an advanced override and must continue to
comply with each provider's current client-identification rules.

Do not publish logs, Compose files, screenshots, or issue reports containing API
keys, webhook URLs, database credentials, session cookies, or private hostnames.

## Upgrading and Rollback

1. Stop the application and take a consistent database and configuration
   backup.
2. Read all release notes between the installed and target versions.
3. Pull the exact version or digest, then start one application instance and
   allow migrations to finish.
4. Verify login, discovery, request creation, and downstream service access
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
