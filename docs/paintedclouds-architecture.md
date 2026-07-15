# PaintedClouds Hub architecture

PaintedClouds Hub is a private, upstream-friendly Seerr extension. Seerr keeps
ownership of movie and television requests. The `server/{api,entity,lib,routes}/hub`
modules add catalog aggregation and requests for albums, artists, e-books and
audiobooks without broadening Seerr's TMDB-specific `Media` entity.

## Trust boundaries

- Browsers only receive normalized catalog, request and health data.
- Service API keys are read from mounted files and never stored in Hub request
  rows or returned by an endpoint.
- Jellyfin remains the identity provider. Seerr permissions protect admin
  operations; non-admin users receive a rolling weighted quota.
- The Hub is reachable only from the LAN and WireGuard networks.
- Forgejo Actions uses a repository-scoped runner and a dedicated
  Docker-in-Docker daemon. Jobs cannot access the Docker daemon hosting
  monitoring services on `ops-01`.

## Sources of truth

- Ansible: hosts, containers, routing, volumes and secret injection.
- PaintedClouds Hub: user request policy and media application policy.
- Sonarr, Radarr, Lidarr and LazyLibrarian: acquisition execution state.
- Jellyfin and Audiobookshelf: library availability.

The old Recyclarr enforcement timer must remain active until the Hub policy
import and comparison has passed. It is disabled only during the final policy
cutover.
