// ============================================================================
// Shared Prisma client singleton.
//
// Why this file exists: Next.js hot-reloads your server code on every save
// in development. If we just did `export const db = new PrismaClient()`
// directly, every single hot-reload would create a *new* PrismaClient — and
// each one opens its own pool of database connections that never gets
// closed. Leave the dev server running for a while and you eventually hit
// Postgres's max-connections limit and everything breaks.
//
// The fix (this is the standard pattern Prisma's own docs recommend for
// Next.js) is to stash the client on `globalThis`, which — unlike a normal
// module-level variable — survives hot-reloads. So: reuse the client on
// `globalThis` if one already exists, otherwise create exactly one.
//
// In production this distinction doesn't matter (there's no hot-reload,
// the process just starts once), but the code below is safe there too.
// ============================================================================

import { PrismaClient } from "@prisma/client";

// TypeScript doesn't know about our custom global property by default, so
// we declare it here. This only affects type-checking — it doesn't create
// anything at runtime.
declare global {
  // eslint-disable-next-line no-var -- `var` is required to attach to globalThis in a `declare global` block
  var __prismaClient: PrismaClient | undefined;
}

// Reuse the client already sitting on globalThis (set by a previous
// hot-reload), or create a fresh one the very first time this module loads.
export const db: PrismaClient = globalThis.__prismaClient ?? new PrismaClient();

// Only stash it on globalThis outside of production. In production each
// process starts once, so there's nothing to preserve across reloads, and
// we'd rather not leave a global reference lying around unnecessarily.
if (process.env.NODE_ENV !== "production") {
  globalThis.__prismaClient = db;
}
