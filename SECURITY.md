# Security Policy

## Supported Versions

PaintedClouds Hub is alpha software. Until a stable support policy is announced,
only the newest published release is eligible for security fixes. Development
branches and older images are unsupported.

Security fixes may require an immediate upgrade. Maintainers may withhold
technical details until a fixed release is available.

## Reporting a Vulnerability

Do not report suspected vulnerabilities in a public issue, discussion, log,
chat, or pull request.

Use this repository's GitHub **Security** tab and select **Report a
vulnerability**. This creates a private security advisory visible only to the
repository's security maintainers. If private vulnerability reporting is not
enabled, do not publish the report; wait until the repository owner provides a
private channel in the repository profile.

Include, where possible:

- affected release, image digest, and commit;
- affected component and configuration;
- reproduction steps or a minimal proof of concept;
- expected and observed behavior;
- likely impact and prerequisites;
- whether the issue is already public;
- a safe way to contact you, if you want follow-up or credit.

Remove API keys, passwords, session cookies, personal data, and unrelated
private infrastructure details. Maintainers will acknowledge a complete report
as capacity permits, coordinate remediation and disclosure, and credit the
reporter unless anonymity is requested. Alpha status means no fixed response or
resolution time is promised.

## Scope

Reports are especially useful for authentication or authorization bypasses,
secret exposure, server-side request forgery, injection, unsafe file access,
privilege escalation, supply-chain compromise, and vulnerabilities in the Hub
request or integration boundaries.

Availability problems in third-party services, insecure configuration of an
operator's network, and upstream vulnerabilities with no additional
PaintedClouds Hub impact should normally be reported to the responsible project.
If in doubt, use the private advisory channel and explain the relationship.

## Deployment Responsibilities

Operators should:

- expose the service through HTTPS and an appropriately configured reverse
  proxy;
- use least-privilege service accounts and API keys;
- prefer `*_FILE` secrets and protect the configuration directory and backups;
- restrict administrative access and keep dependencies and downstream services
  current;
- verify release digests and signatures when supplied;
- never expose database, Lidarr, LazyLibrarian, Servarr, downloader, or Home
  Assistant endpoints directly to untrusted networks.

The MIT License includes an express warranty disclaimer. This security policy
does not create a warranty or service-level agreement.
