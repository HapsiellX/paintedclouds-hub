# Support

PaintedClouds Hub is community-maintained alpha software. Support is best-effort
and no response or resolution time is guaranteed.

PaintedClouds Hub is independent from Seerr. Do not ask the Seerr maintainers or
community to diagnose fork-specific behavior. If a problem is confirmed to
exist unchanged in upstream Seerr, link the upstream report rather than
cross-posting without context.

## Before Asking for Help

1. Read the README, release notes, alpha limitations, and open issues.
2. Confirm that the problem occurs on the newest supported PaintedClouds Hub
   release.
3. Check the health and logs of the relevant downstream service.
4. Reproduce with the smallest safe configuration possible.
5. Remove all secrets and private data from diagnostics.

Use GitHub Issues for reproducible bugs, feature requests, and documentation
problems. Use GitHub Discussions for usage questions if Discussions are enabled
for the repository. Vulnerabilities must follow [SECURITY.md](./SECURITY.md).

## Include in a Bug Report

- exact application version, commit, and container digest;
- installation method, CPU architecture, and database backend;
- relevant browser and operating system;
- affected media type and integration;
- clear reproduction steps, expected result, and actual result;
- sanitized application and downstream-service logs;
- whether the problem survives a restart and occurs without a reverse proxy.

Never include credentials, session cookies, webhook URLs, database dumps,
private hostnames or addresses, or unredacted personal information.

## Support Boundaries

Maintainers may close reports that cannot be reproduced, concern an unsupported
version, omit requested diagnostics, are caused by an unsupported deployment,
or belong to another project. The community cannot provide legal advice,
guarantee metadata accuracy, locate copyrighted media, or help bypass access
controls.

Requests for assistance acquiring infringing content are out of scope. Users
and operators are responsible for complying with applicable law and the terms
of their metadata, media-server, acquisition, indexer, and download services.
