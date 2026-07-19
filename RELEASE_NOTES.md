# V0.8.0-beta.1 operator notes

This public beta introduces StefARR's normalized acquisition lifecycle for
movies, series, music, e-books, and audiobooks. The Requests view now separates
queued work, active transfers, post-processing/import, pauses, unresolved
problems, and confirmed library availability. Provider-specific progress is
shown only when the provider exposes reliable evidence.

## Supported upgrade and rollback

- The supported direct upgrade path is **V0.7.0 to V0.8.0-beta.1** on SQLite
  and PostgreSQL.
- Back up the complete configuration directory and database before upgrading.
- Database downgrade is not supported. Rollback requires restoring the V0.7.0
  image together with its matching pre-upgrade database and configuration
  backup.

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
