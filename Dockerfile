FROM node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS base
ARG SOURCE_DATE_EPOCH
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY . ./app
WORKDIR /app

FROM base AS prod-deps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --prod --frozen-lockfile

# Remove large native modules for linux-x64-gnu platform (we use alpine which is musl-based)
# not supported in pnpm for now due to this bug: https://github.com/pnpm/pnpm/issues/9654
RUN du -shL ./node_modules/.pnpm/* | grep '[0-9]M.*' | grep 'linux-x64-gnu@' | awk '{print $2}' | xargs rm -rf
# Remove large module files not needed for production
RUN if [ -d node_modules/.pnpm ]; then \
  find node_modules/.pnpm -type d \( \
  -path "*ace-builds/src-noconflict" -o \
  -path "*ace-builds/src" -o \
  -path "*ace-builds/src-min" -o \
  -path "*country-flag-icons/react" -o \
  -path "*country-flag-icons/string" -o \
  -path "*country-flag-icons/1x1" -o \
  -path "*@heroicons/react/16" \
  \) -exec rm -rf {} + || true; \
  fi

FROM base AS build

ARG COMMIT_TAG
ENV COMMIT_TAG=${COMMIT_TAG}

RUN \
  case "${TARGETPLATFORM}" in \
  'linux/arm64' | 'linux/arm/v7') \
  apk update && \
  apk add --no-cache \
  python3=3.12.13-r0 \
  make=4.4.1-r3 \
  g++=15.2.0-r2 \
  gcc=15.2.0-r2 \
  gcompat=1.1.0-r4 \
  bash=5.3.3-r1 && \
  npm install --global node-gyp@12.2.0 \
  ;; \
  esac

RUN --mount=type=cache,id=pnpm,target=/pnpm/store CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile

RUN pnpm build

RUN rm -rf .next/cache

FROM node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
ARG SOURCE_DATE_EPOCH
ARG COMMIT_TAG
ARG BUILD_VERSION
ARG BUILD_DATE
ARG REPOSITORY_URL
ENV NODE_ENV=production
ENV COMMIT_TAG=${COMMIT_TAG}
ENV APP_VERSION=${BUILD_VERSION}

LABEL org.opencontainers.image.title="PaintedClouds Hub" \
  org.opencontainers.image.description="Experimental multi-media request hub based on Seerr" \
  org.opencontainers.image.source="${REPOSITORY_URL}" \
  org.opencontainers.image.revision="${COMMIT_TAG}" \
  org.opencontainers.image.version="${BUILD_VERSION}" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache \
  libcrypto3=3.5.7-r0 \
  libssl3=3.5.7-r0 \
  tzdata=2026c-r0 && \
  rm -rf /usr/local/lib/node_modules/npm && \
  rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node next.config.ts ./next.config.ts
COPY --chown=node:node seerr-api.yml ./seerr-api.yml
COPY --chown=node:node public ./public
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/dist ./dist

RUN mkdir -p config/db config/logs && \
  touch config/DOCKER && \
  echo "{\"commitTag\": \"${COMMIT_TAG}\"}" > committag.json && \
  chown -R node:node /app/config /app/committag.json

USER node:node

EXPOSE 5055

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --quiet --output-document=/dev/null http://127.0.0.1:5055/api/v1/status || exit 1

CMD [ "node", "dist/index.js" ]
