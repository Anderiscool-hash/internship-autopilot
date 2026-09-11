# Container image for self-hosting.
#
# Multi-stage so the shipped image carries the built app and its production
# dependencies, not the toolchain that produced them.
#
# Note what this image does NOT include: Postgres, and the scanner. The
# database is a separate service (a managed one, or another container), and
# the scanner is a second long-running process — see docs/DEPLOYING.md. A
# single container that quietly ran both would be convenient right up until
# the first restart lost the schedule.

FROM node:22-slim AS deps
WORKDIR /app
# Build tooling for any native dependency, removed with this stage.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci installs exactly what the lockfile pins. The Prisma client is
# generated code and must exist before the build.
RUN npm ci && npx prisma generate

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Nothing connects during a build — every page renders on request — so a
# placeholder URL is enough to satisfy Prisma's client construction.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user: this process talks to the public internet.
RUN useradd --system --create-home --uid 1001 autopilot
USER autopilot

COPY --from=build --chown=autopilot:autopilot /app/node_modules ./node_modules
COPY --from=build --chown=autopilot:autopilot /app/.next ./.next
COPY --from=build --chown=autopilot:autopilot /app/public ./public
COPY --from=build --chown=autopilot:autopilot /app/package.json ./package.json
COPY --from=build --chown=autopilot:autopilot /app/prisma ./prisma
COPY --from=build --chown=autopilot:autopilot /app/scripts ./scripts
COPY --from=build --chown=autopilot:autopilot /app/src ./src
COPY --from=build --chown=autopilot:autopilot /app/tsconfig.json ./tsconfig.json

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Migrations run at start rather than at build: the schema belongs to the
# database, and the build has no business touching it.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
