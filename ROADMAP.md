# Roadmap

This roadmap communicates direction, not a promise of scope or delivery date.
Security, data integrity, upstream changes, and maintainer capacity can reorder
the work.

## V0.2 Stable Scope

V0.2 establishes the first stable PaintedClouds Hub foundation:

- Unified search, discovery, canonical detail pages, and request activity for
  movies, television, artists, albums, e-books, and audiobooks.
- Edition-aware book requests with language and format preferences.
- Encrypted administrator-managed integration settings with a documented V0.1
  migration and matching-key backup requirement.
- Transactional, configurable request quotas for SQLite and PostgreSQL.
- Durable metadata caching with bounded stale fallback and background
  reconciliation of Lidarr and LazyLibrarian request states.
- German and English core Hub workflows, privacy-preserving history, and
  administrator health and retry controls.
- Reproducible release candidates, exact-digest promotion, SBOMs, provenance,
  signed artifacts, and documented upgrade and rollback procedures.

## Next Product Work

- Availability and request-state badges directly on discovery and detail
  views.
- Richer author, series, audiobook narrator, and multi-edition matching.
- Optional personalization based only on operator-configured libraries.
- Saved filters, sorting, pagination controls, and improved empty states.
- Accessibility and mobile-navigation audits for all Hub-specific screens.
- More localized operator and provider error messages.

## Next Platform Work

- Provider contract tests for Lidarr and LazyLibrarian compatibility changes.
- More detailed reconciliation metrics and operator-visible failure history.
- A tested upstream synchronization cadence and automated conflict reporting.
- Backup/restore smoke tests for encrypted settings on both supported
  databases.
- Broader browser-level tests for search, request, approval, and history flows.

Feature requests are welcome, but acceptance into this document does not commit
maintainers to implementation.
