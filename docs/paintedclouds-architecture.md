# PaintedClouds Hub architecture

PaintedClouds Hub is an independent Seerr fork that adds catalog aggregation
and request workflows for artists, albums, e-books, and audiobooks. Existing
Seerr entities and request paths remain responsible for movie and television
media. Hub-specific modules avoid broadening Seerr's TMDB-oriented `Media`
entity with incompatible identifiers and lifecycle states.

## Components

- `server/api/hub` normalizes metadata-provider results into a shared catalog
  representation.
- `server/entity/HubRequest.ts` and `HubAuditEvent.ts` persist Hub request state
  and security-relevant actions.
- `server/lib/hub` applies policy, communicates with acquisition services, and
  emits optional notifications.
- `server/routes/hub.ts` validates and authorizes the browser-facing Hub API.
- Hub pages and components render normalized discovery, request, and health
  information without receiving downstream API keys.

## Trust boundaries

- Browsers and ordinary users are untrusted. Validation and authorization occur
  on the server, and responses must not expose service credentials, private
  endpoints, internal errors, or another user's requests.
- The application database and configuration directory contain sensitive user,
  session, request, and integration data. Operators must restrict and back them
  up together.
- Media servers provide identity and library context. Their accounts and tokens
  should have only the permissions required by the configured workflow.
- Acquisition services execute requests and are separate trust domains. API
  keys should be file-mounted where possible and must never be returned by an
  endpoint or stored in Hub request rows.
- Metadata and artwork providers are external systems. Calls require timeouts,
  rate limits, caching, safe error handling, provider attribution, and an
  appropriate identifying User-Agent.
- Optional notification endpoints receive selected request event fields and
  must be treated as disclosures to another system.

## Sources of truth

- PaintedClouds Hub owns user request policy, approval state, and its audit
  records.
- Sonarr, Radarr, Lidarr, and LazyLibrarian own acquisition execution state.
- Jellyfin, Plex, Emby, and audiobook-library software own library availability
  and playback state.
- Metadata providers own their catalog records and identifiers.
- Deployment automation owned by an operator controls hosts, containers,
  routing, volumes, backups, and secret injection; it is not part of the public
  application repository.

State copied from another system is a cache or reference, not a replacement for
that system's source of truth. Reconciliation must be idempotent and tolerate a
downstream service being unavailable.

## Deployment model

PaintedClouds Hub is designed for self-hosting. It should run as a non-root
container with persistent configuration storage, HTTPS at the network edge, and
network access limited to required users and integrations. Downstream service
ports and databases should not be exposed to untrusted networks.

See `SECURITY.md`, `PRIVACY.md`, and `ATTRIBUTION.md` at the repository root for
the public security, data-flow, and provider requirements.
