# Roadmap

This roadmap communicates direction, not a promise of scope or delivery date.
Security, data integrity, upstream changes, and maintainer capacity can reorder
the work.

## Alpha Exit Criteria

- Neutral, reproducible container installation with documented configuration,
  backup, migration, and rollback procedures.
- End-to-end coverage for movie, television, artist, album, e-book, and
  audiobook request paths.
- Configurable Hub policies, languages, paths, and discovery shelves.
- Reliable synchronization of downstream request and acquisition states.
- Clear metadata-provider attribution, caching, throttling, and failure
  behavior.
- Complete public branding, translations for core Hub workflows, and removal of
  private deployment assumptions.
- Signed release artifacts, SBOMs, dependency-license review, and documented
  vulnerability handling.

## Planned Product Work

- Rich artist, album, author, work, and edition detail pages.
- Better edition, language, format, series, and audiobook matching.
- Availability and request-state badges across discovery views.
- Optional personalization based on an operator's configured libraries.
- Improved accessibility, mobile layouts, placeholders, filters, and sorting.
- Administrative retry, reconciliation, and understandable failure handling.

## Planned Platform Work

- Add a transactional quota ledger for safe non-administrator auto-approval on
  both SQLite and PostgreSQL.
- Settings UI for optional Hub services and policy values.
- Background jobs and durable metadata caching.
- Better health checks and observability without project-operated telemetry.
- Tested SQLite and PostgreSQL migration matrices.
- A documented upstream synchronization cadence.

Feature requests are welcome, but acceptance into this document does not commit
maintainers to implementation.
