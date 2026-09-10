/**
 * Tests for single-user auth.
 *
 * The cases that matter are the refusals: a tampered token, an expired one, a
 * token signed with a different password, and — the one this whole file exists
 * for — a remote request reaching a deployment where nobody set a password.
 */

import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  decideAccess,
  isLocalHost,
  SESSION_TTL_SECONDS,
  timingSafeEqual,
  verifySessionToken,
} from "./session";

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-10T12:00:00.000Z");

describe("isLocalHost", () => {
  it("recognises this machine and the home network", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1:3000",
      "[::1]:3000",
      "192.168.1.175:3000",
      "10.0.0.4:3000",
      "172.16.5.9:3000",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("treats anything reachable from outside as remote", () => {
    for (const host of [
      "lagranfamiliagrocery.com",
      "jobs.lagranfamiliagrocery.com",
      "something.trycloudflare.com",
      "203.0.113.9",
      // Deliberately not fooled by a local-looking prefix on a real domain.
      "localhost.evil.com",
      "192.168.1.175.evil.com",
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("treats a missing host as remote", () => {
    expect(isLocalHost(null)).toBe(false);
    expect(isLocalHost("")).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("session tokens", () => {
  it("accepts a token it just minted", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(await verifySessionToken(token, PASSWORD, NOW)).toBe(true);
  });

  it("rejects a token signed with a different password", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(await verifySessionToken(token, "some other password", NOW)).toBe(false);
  });

  it("rejects a token whose expiry was edited", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${9_999_999_999}.${signature}`;
    expect(await verifySessionToken(forged, PASSWORD, NOW)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const later = new Date(NOW.getTime() + (SESSION_TTL_SECONDS + 60) * 1000);
    expect(await verifySessionToken(token, PASSWORD, later)).toBe(false);
  });

  it("rejects junk without throwing", async () => {
    for (const token of ["", "nonsense", "abc.def", ".", "123.", "..", "1.!!!"]) {
      expect(await verifySessionToken(token, PASSWORD, NOW), token).toBe(false);
    }
    expect(await verifySessionToken(undefined, PASSWORD, NOW)).toBe(false);
  });
});

describe("decideAccess", () => {
  it("lets local requests straight through, password or not", async () => {
    expect(
      await decideAccess({ host: "localhost:3000", token: undefined, password: null }),
    ).toEqual({ allow: true });
  });

  it("refuses remote requests when no password is configured", async () => {
    // The accident this exists to prevent: tunnelled or deployed with the
    // password never set.
    expect(
      await decideAccess({
        host: "jobs.lagranfamiliagrocery.com",
        token: undefined,
        password: null,
      }),
    ).toEqual({ allow: false, reason: "not-configured" });
  });

  it("asks a remote request without a session to log in", async () => {
    expect(
      await decideAccess({
        host: "jobs.lagranfamiliagrocery.com",
        token: undefined,
        password: PASSWORD,
      }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });

  it("lets a remote request with a valid session through", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(
      await decideAccess({
        host: "jobs.lagranfamiliagrocery.com",
        token,
        password: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ allow: true });
  });

  it("invalidates existing sessions when the password changes", async () => {
    const token = await createSessionToken("old password", NOW);
    expect(
      await decideAccess({
        host: "jobs.lagranfamiliagrocery.com",
        token,
        password: "new password",
        now: NOW,
      }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });
});
