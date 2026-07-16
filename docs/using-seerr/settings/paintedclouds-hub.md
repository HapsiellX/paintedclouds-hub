---
title: PaintedClouds Hub
description: Configure music, book, quota, metadata, and reconciliation workflows.
sidebar_position: 5
---

# PaintedClouds Hub settings

Open **Settings → PaintedClouds Hub** as an administrator. This screen is the
authoritative configuration source from V0.2 onward.

## Acquisition services

Configure Lidarr with its base URL, API key, root directory, quality profile,
and metadata profile. Configure LazyLibrarian with its base URL and API key.
Save new credentials before running a connection test. Secret values are masked
after saving and can only be replaced or explicitly deleted.

Service URLs may use private network addresses because acquisition services are
normally local. Redirects, embedded credentials, link-local metadata addresses,
and non-HTTP protocols are rejected.

## Metadata and matching

Provide a monitored project contact email. PaintedClouds Hub identifies itself
to MusicBrainz and Open Library and sends that address to those providers.
Search results are cached for six hours, detail data for 24 hours, and stale
data can be served for up to seven days during a provider outage.

Book requests use an Open Library work and, where available, an explicit
edition. If multiple editions exist, the requester must choose one. An ISBN is
passed to LazyLibrarian when the selected edition supplies one.

## Automatic approval

Automatic approval is disabled after a V0.1 upgrade until an administrator
enables it. Set the default points and rolling window, then optionally override
both values on an individual user's settings page. Reservations and consumption
are transactional on SQLite and PostgreSQL.

Reserved points count immediately. They become consumed once the downstream
service accepts the request. A final submission failure without a downstream
item releases the reservation. Administrators bypass this budget.

## Reconciliation

The reconciliation job maps Lidarr and LazyLibrarian state into the common Hub
request lifecycle. Its interval can be set between one and sixty minutes.
Administrators can invoke it immediately from the Hub system-status area or the
Jobs page. Temporary downstream errors retain the last known good request state
and are logged without exposing credentials to users.

## V0.1 upgrade

On the first V0.2 start, legacy `HUB_*` environment values and supported
`*_FILE` secrets are imported and encrypted once. Verify the values and service
tests in the Admin UI, then remove the legacy variables. Back up
`settings.json`, `hub-secrets.key`, and the database before the upgrade.
