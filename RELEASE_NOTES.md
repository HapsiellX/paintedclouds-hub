# V0.8.0-beta.7 operator notes

This beta publishes the current Forgejo catalog improvements. Book and
audiobook discovery can use the academic-catalog fallback when the primary
metadata sources return no useful result, and partial catalog searches now
retry transient provider failures instead of silently returning an incomplete
shelf.

Authentication and remote-image handling are hardened. Login, password-reset,
and media-account-link attempts have bounded rate limits. Jellyfin sign-in
requires both credential fields before contacting the configured server. The
image proxy now accepts only explicitly allowed origins, rejects embedded
credentials and origin overrides, enforces a 15-second timeout and 25 MiB
response limit, and caches only supported raster image formats. The anime
mapping refresh no longer performs a separate existence check before reading
file metadata, and mobile settings navigation verifies every selected route
against the configured tab list.

Patch updates include React 19.2.8, Sharp 0.35.3, Nodemailer 9.0.5, OpenPGP
6.3.1, FormatJS, Autoprefixer, and matching development types and tools. The
production dependency audit reports no known vulnerabilities. The Cypress-only
`extract-zip` advisory and the documentation-only `image-size` advisories have
no patched upstream release as of this beta and are not present in the runtime
dependency audit or production image path.

No application API or database schema changes are included in Beta 7.

## Previous Beta 6 changes

This security beta resolves the August 2026 dependency advisories reported by
GitHub and Trivy. Direct runtime updates include Next.js 16.2.11, Undici 8.9.0,
Sharp 0.35.0, js-yaml 4.3.1, Nanoid 5.1.16, TypeORM 0.3.31, and the matching
Next.js lint packages. PostCSS and vulnerable transitive dependencies used by
the application, documentation generator, and duplicate detector are pinned to
patched releases as well.

The complete source, secret, and configuration scan reports no fixable high or
critical findings. Two high-severity `image-size` advisories remain visible for
the documentation-only dependency because no patched upstream release exists
as of this release; the lockfile already uses the newest published version.
They are not part of the production runtime image.

No application API or database schema changes are included in Beta 6.

## Previous Beta 5 changes

This security beta updates Axios from 1.16.0 to 1.18.0. It fixes
GHSA-xj6q-8x83-jv6g, which could allow an existing prototype-pollution flaw in
a host application to influence outbound Basic authentication fields. The
update also strengthens cross-origin redirect header handling and rejects
malformed HTTP(S) URLs. No application API or database schema changes are
included.

This beta also exposes the VPN gate connection test through the validated
OpenAPI service enum so the Settings button reaches the already protected
server handler.

This beta adds a fail-closed torrent fallback for failed movie and episode
downloads. StefARR only submits a torrent release already accepted by
Radarr/Sonarr when the dedicated read-only Gluetun gate reports a running VPN,
a public VPN address, and an explicitly allowed exit country. Gate timeouts,
geolocation failures, disallowed countries, rejected releases, or insufficient
seeders block the fallback. No fallback starts a request or bypasses ARR's
quality and release rules.

Administrators configure the encrypted gate key, allowlisted countries,
minimum seeders, and retry cooldown in Settings > StefARR integrations. The
request issue records the latest fallback result without storing a release
title or public IP.

This beta fixes episode-level acquisition problems that could remain active
after a successful import or a later failed quality-upgrade attempt. Sonarr's
current episode state is now authoritative: imported episodes, episodes that
have not aired yet, and episodes currently being processed are not presented
as missing downloads. Confirmed missing, aired episodes remain visible and
retryable.

Episode metadata lookups use bounded parallelism so large requested series do
not create an unbounded provider burst. The Requests browser flow includes a
regression check for resolved upgrade failures and future episodes.

## Supported upgrade and rollback

- The supported direct upgrade paths are **V0.7.0 and every earlier
  V0.8.0 beta through V0.8.0-beta.6 to V0.8.0-beta.7** on SQLite and
  PostgreSQL.
- V0.8.0-beta.7 includes the nullable torrent-fallback state introduced in
  Beta 3 and requires no additional database migration from Beta 5.
  Back up the complete configuration directory and database before upgrading.
- Database downgrade is not supported. Rollback requires restoring the image
  together with its matching pre-upgrade database and configuration backup.

## V0.8 acquisition lifecycle

This public beta introduces StefARR's normalized acquisition lifecycle for
movies, series, music, e-books, and audiobooks. The Requests view now separates
queued work, active transfers, post-processing/import, pauses, unresolved
problems, and confirmed library availability. Provider-specific progress is
shown only when the provider exposes reliable evidence.

## Beta limitations

- Provider availability, queue, and history APIs remain the source of truth;
  an unreachable or incomplete provider is displayed as stale or unknown, not
  guessed as successful.
- Lidarr and LazyLibrarian do not expose the same byte-level progress detail as
  Radarr, Sonarr, and SABnzbd, so StefARR shows their reliable lifecycle state
  instead of a synthetic percentage.
- Retry is offered only where StefARR can issue a safe, supported downstream
  command. Acknowledgement changes only the StefARR display.

See `docs/v0.8-acquisition-status.md` and `PRIVACY.md` in the exact source
commit for the full status, retention, permission, and data-minimization model.

StefARR by PaintedClouds is an independent MIT-licensed fork based on Seerr
V3.3.0. The upstream copyright, license, and project lineage remain preserved
in `LICENSE` and `ATTRIBUTION.md`.
