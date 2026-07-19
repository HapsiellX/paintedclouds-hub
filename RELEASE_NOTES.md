# V0.8.0-beta.2 operator notes

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

- The supported direct upgrade paths are **V0.7.0 or V0.8.0-beta.1 to
  V0.8.0-beta.2** on SQLite and PostgreSQL.
- V0.8.0-beta.2 adds no database migration. Back up the complete configuration
  directory and database before upgrading.
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
