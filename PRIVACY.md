# Privacy and External Data Flows

StefARR by PaintedClouds is self-hosted. The person or organization operating an
instance controls its users, configuration, logs, database, integrations,
retention, and legal obligations. The StefARR project does not
operate hosted instances and does not receive an instance's data merely because
the software is installed.

This document describes the application's expected data flows. Operators must
assess their own configuration and jurisdiction.

## Data Stored by an Instance

Depending on enabled features, the application can store:

- local, Jellyfin, Plex, or Emby account identifiers and profile information;
- sessions, permissions, notification preferences, and request history;
- movie, television, music, book, and audiobook identifiers and metadata;
- request decisions, downstream target identifiers, audit events, and errors;
- service URLs and application settings;
- operational logs, which may contain account identifiers, client addresses,
  requested paths, service errors, media titles, and hostnames;
- cached metadata, images, and avatars.

Hub API keys and webhook URLs are encrypted in `settings.json`; the matching
`hub-secrets.key` decrypts them. Both files, database credentials, and all other
application secrets remain sensitive and must be access-controlled together.

Live acquisition snapshots from Radarr, Sonarr, Lidarr, LazyLibrarian, and
SABnzbd are held in memory for the requests view. Normalized acquisition issues
are stored without raw release filenames, filesystem paths, or download-client
identifiers. Open issues remain until resolved; resolved issues are retained for
seven days. The public activity response follows existing request permissions
and contains only requested titles, sanitized states, byte totals, remaining
time, episode numbers, and localized reason codes for work the current user is
allowed to see.

## External Services

An instance may communicate with:

- TMDB and other metadata providers used by the inherited movie and television
  discovery workflows;
- MusicBrainz for artist and release metadata;
- Cover Art Archive for album artwork;
- Open Library and its cover service for book metadata and artwork;
- the operator's Jellyfin, Plex, or Emby server for authentication and library
  information;
- the operator's Sonarr, Radarr, Lidarr, LazyLibrarian, Prowlarr, SABnzbd, and
  other configured acquisition services;
- configured notification services and an optional Home Assistant webhook;
- update or release endpoints used by inherited version-check functionality.

Requests can disclose the instance's public IP address, request time, software
User-Agent, search terms, provider identifiers, preferred language, and other
parameters necessary for the requested feature. Artwork may be loaded through
the application or directly by a user's browser depending on configuration,
which can disclose the browser's IP address and normal HTTP headers to the image
provider.

The metadata contact address configured in the Hub Admin UI is deliberately
transmitted as a contact identifier: it is included in the MusicBrainz
User-Agent and sent to Open Library as the `email` request parameter. A custom
User-Agent may itself contain contact information. Operators should use a
monitored, role-based public address rather than a person's private address,
inform affected administrators, and understand that providers can retain these
values under their own policies.

Each external provider has its own privacy policy and terms. See
[ATTRIBUTION.md](./ATTRIBUTION.md) for provider links.

## Project Telemetry

The repository does not intentionally add PaintedClouds-operated analytics or
telemetry. This statement does not cover third-party API requests, operator
monitoring, reverse-proxy logs, notification providers, downstream services, or
functionality inherited from upstream. Operators should inspect release notes
and network behavior for their exact version and configuration.

## Operator Guidance

Operators should:

- publish an instance-specific privacy notice to their users;
- enable only integrations they need and use least-privilege credentials;
- configure appropriate log, audit, cache, request, and backup retention;
- restrict access to logs, configuration, databases, and backups;
- avoid placing personal data in titles, webhook payloads, or support reports;
- honor lawful access, correction, export, and deletion requests applicable to
  their deployment;
- understand that deleting an application request does not necessarily delete
  corresponding records from downstream services, provider logs, or backups.

## Support and Issue Reports

Public issue reports are permanent public disclosures. Redact names, email
addresses, IP addresses, domains, media-library details, API keys, cookies,
tokens, webhook URLs, database contents, and logs unrelated to the problem.
Security-sensitive information belongs only in the private channel described in
[SECURITY.md](./SECURITY.md).

## Changes

Data flows can change as features are added. Material changes should be recorded
in release notes and this document. This document is informational and is not a
substitute for an operator's own privacy assessment or legal advice.
