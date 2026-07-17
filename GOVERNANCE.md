# Governance

## Project Status

StefARR by PaintedClouds is an independent, community-maintained,
MIT-licensed Seerr fork in public beta. It is not affiliated with or endorsed
by Seerr.
This governance model is intentionally lightweight and can evolve as the
maintainer group grows.

## Roles

- **Users** run the software and may participate in issues and discussions.
- **Contributors** submit documentation, tests, translations, code, design, or
  review.
- **Reviewers** are trusted contributors who regularly review a defined area.
- **Maintainers** can merge changes, triage reports, and manage releases.
- **Security maintainers** can access private vulnerability reports and
  coordinate fixes and disclosure.

Repository permissions are the authoritative record of current role holders.
No role is permanent, and access should be removed when it is no longer needed.

## Decision Making

Routine changes are decided through pull-request review. Maintainers seek rough
consensus based on user impact, security, maintainability, compatibility,
evidence, and the project's stated scope. A maintainer may reject a change that
creates unacceptable security, legal, maintenance, or compatibility risk.

Changes to licensing, governance, security boundaries, data collection,
supported migration paths, or release signing require explicit maintainer
review and must not be merged as incidental changes.

When consensus cannot be reached, the repository owner makes the final decision
and records the reasoning publicly unless security or privacy prevents it.

## Releases

Releases are built from reviewed commits through the repository's documented
release workflow. Release maintainers must verify:

- the target commit and version;
- test, build, migration, and installation results;
- registry destinations and artifact digests;
- vulnerability, secret, dependency-license, and SBOM results;
- release notes, known limitations, the exact upstream base and exact StefARR
  source commit, and rollback guidance;
- signatures and attestations where the release process supports them.

When at least two active maintainers are available, a different maintainer must
review the release candidate before publication. During the bootstrap phase, a
single owner may release only after documenting the completed checklist in the
release record.

## Security

Private vulnerability information is shared only with people required to
resolve it. Security maintainers may temporarily bypass the normal public review
process to prepare an embargoed fix, but the resulting release and material
changes must be documented after coordinated disclosure. See
[SECURITY.md](./SECURITY.md).

## Conflicts of Interest

Reviewers disclose personal, employment, financial, or project relationships
that could reasonably affect a decision and recuse themselves when appropriate.
No contributor reviews their own change as the sole approval when another
qualified reviewer is available.

## Upstream Relationship

The project should preserve a clear upstream remote and regularly assess Seerr
security and maintenance changes. Contributions suitable for Seerr may be
offered upstream, subject to Seerr's contribution rules. StefARR
maintainers must not imply that upstream will support fork-specific code.

## Amendments

Governance changes use a dedicated pull request with a clear rationale and an
appropriate review period. Urgent security contact or access changes may be
made immediately and documented afterward.
