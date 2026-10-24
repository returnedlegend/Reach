# syntax=docker/dockerfile:1

# Build and runtime stages use the same Debian libc family so native packages
# such as @node-rs/argon2 match the production image.
FROM node:24-bookworm-slim AS build-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --include=dev --strict-ssl=true; \
    else \
      npm ci --include=dev --strict-ssl=true; \
    fi

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production
ARG NEXT_PUBLIC_MAP_STYLE_URL=
ARG NEXT_PUBLIC_MAP_RASTER_TILE_URL=
ARG NEXT_PUBLIC_MAP_ATTRIBUTION=
ARG NEXT_PUBLIC_MAP_RASTER_ATTRIBUTION=
ENV NEXT_PUBLIC_MAP_STYLE_URL=${NEXT_PUBLIC_MAP_STYLE_URL} \
    NEXT_PUBLIC_MAP_RASTER_TILE_URL=${NEXT_PUBLIC_MAP_RASTER_TILE_URL} \
    NEXT_PUBLIC_MAP_ATTRIBUTION=${NEXT_PUBLIC_MAP_ATTRIBUTION} \
    NEXT_PUBLIC_MAP_RASTER_ATTRIBUTION=${NEXT_PUBLIC_MAP_RASTER_ATTRIBUTION}
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --omit=dev --strict-ssl=true; \
    else \
      npm ci --omit=dev --strict-ssl=true; \
    fi

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    REACH_ENVIRONMENT=production \
    REACH_RELEASE_PROFILE=core \
    REACH_COMMUNITY_DB=/var/lib/reach/community.sqlite \
    REACH_COMMUNITY_ENABLED=false \
    REACH_ACCOUNT_ENABLED=false \
    REACH_EMAIL_PROVIDER=disabled \
    REACH_AI_PROVIDER=disabled \
    REACH_AI_DATA_POLICY_ACCEPTED=false \
    REACH_AI_FREE_ONLY=true \
    REACH_AI_ALLOW_PAID=false \
    OSM_ROUTER_MODE=disabled

# Next's standalone server does not include public/ or .next/static by itself.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Keep the complete production dependency set for the TypeScript worker scripts.
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node data ./data
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# A Docker named volume inherits this directory's ownership on first use.
RUN mkdir -p /var/lib/reach /app/.next && \
    chown -R node:node /var/lib/reach /app/.next

USER node
EXPOSE 3000
CMD ["sh", "-ec", "node --import tsx scripts/release-preflight.ts && exec node server.js"]
