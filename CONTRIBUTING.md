# Contributing to PaintedClouds Hub

Thank you for helping improve PaintedClouds Hub. By participating, you agree to
follow the [Code of Conduct](./CODE_OF_CONDUCT.md) and this guide.

PaintedClouds Hub is an independent Seerr fork. Use this repository for
fork-specific work. Contributions intended for Seerr must follow
[Seerr's own contribution process](https://github.com/seerr-team/seerr/blob/develop/CONTRIBUTING.md).

## Before You Start

- Search existing issues and pull requests.
- Use an issue to discuss broad features, schema changes, new external services,
  privacy changes, or breaking behavior before investing substantial work.
- Keep changes focused. Do not combine unrelated cleanup with a fix.
- Never commit credentials, personal data, private infrastructure, generated
  databases, logs, or local tool state.
- Vulnerabilities follow [SECURITY.md](./SECURITY.md), not the public issue or
  pull-request workflow.

## Development Setup

Requirements:

- Node.js 22.x
- pnpm 10.x as pinned by `packageManager` in `package.json`
- Git
- build tools required by native Node dependencies

```bash
git clone YOUR_FORK_URL
cd paintedclouds-hub
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`YOUR_FORK_URL` means the URL of your personal fork; do not copy credentials
into the command or documentation.

Create a descriptive branch from the repository's current default development
branch. Keep your fork synchronized without rewriting other contributors'
published history.

## Required Validation

Run checks appropriate to the change. A code change is normally expected to
pass all of:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run relevant Cypress tests for user-facing workflows. Manually verify the
affected workflow against safe test services. Database changes require matching
SQLite and PostgreSQL migrations plus forward-migration tests. Do not rely on CI
as the first test run.

Documentation-only changes should at minimum pass formatting and applicable
link or documentation builds.

## Pull Requests

- Use a clear title following Conventional Commits, such as `fix:`, `feat:`,
  `docs:`, `test:`, or `chore:`.
- Explain the problem, the scope of the solution, user-visible effects, risks,
  and rollback considerations.
- Link the issue where one exists.
- Record exact validation commands and manual scenarios; do not write only
  "tests pass."
- Add or update tests, API schemas, translations, migration guidance,
  configuration tables, privacy disclosures, attribution, and limitations when
  the change affects them.
- Include sanitized screenshots for visual changes.
- Expect review and revise the change yourself. Maintainers may close changes
  that are unsafe, too broad, untestable, or outside project scope.

## AI-Assisted Contributions

AI tools may assist a contribution, but a human contributor remains fully
responsible for correctness, security, licensing, privacy, testing, and review
responses. Unreviewed generated submissions are not accepted.

Disclose material AI assistance in the pull request, including whether it was
used for research, code, tests, documentation, translation, or review. Verify
all generated claims and ensure no confidential material was sent to an
external model. The contributor must understand and be able to maintain every
submitted change.

## Code, API, and UI Expectations

- Follow the existing TypeScript, React, Express, and formatting conventions.
- Validate untrusted input at trust boundaries and enforce authorization on the
  server.
- Do not expose downstream errors, secrets, internal URLs, or stack traces to
  ordinary users.
- Use timeouts, bounded retries, rate limits, caching, and an identifying
  User-Agent as required by external providers.
- New integrations must document their data flows, credentials, minimum
  permissions, terms, attribution, and failure behavior.
- User-facing strings must use the localization system. Keep text concise,
  accessible, and consistent.
- Changes to external APIs must update `seerr-api.yml` and relevant tests.

## Database Migrations

The project supports SQLite and PostgreSQL. Schema changes require one migration
for each backend. Migrations must preserve user data, be deterministic, and be
safe to retry where the migration framework permits. Document backup and
rollback implications. A downgrade is not assumed to be supported.

## Licensing and Provenance

By contributing, you agree that your contribution may be distributed under the
repository's MIT License. Submit only work you have the right to contribute.
Preserve existing copyright and license notices. Identify copied or adapted
material and its compatible license in the pull request and, where required, in
[ATTRIBUTION.md](./ATTRIBUTION.md).

Artwork, screenshots, fixtures, metadata, and generated content require the
same provenance care as source code. Do not add third-party logos or media
artwork merely because they are publicly accessible.

## Upstream Synchronization

Do not mix an upstream merge or rebase with feature work. Upstream updates need
a dedicated pull request describing the before/after commits, conflicts,
migrations, security changes, and validation performed. Preserve upstream
attribution and call out fork behavior that intentionally diverges.
