/**
 * Tests for single-user auth.
 *
 * The cases that matter are the refusals: a tampered token, an expired one, a
 * token signed with a different password, and a request reaching a deployment
 * where nobody set a password.
 *
 * Above all of those sits the forged-host block. `decideAccess` used to start
 * with `if (isLocalHost(options.host)) return { allow: true }`, reading the
 * `Host:` header — which the client writes. Against the running app,
 * `Host: evil.example.com` was refused with a 503 while `Host: localhost`,
 * `Host: 10.1.2.3` and `Host: [::1]` each returned the owner's pages in full:
 * name, email, phone, work authorization, employment history. On a cloud host
 * the private-range patterns were worse than forgeable, since 10.x IS the
 * internal network there and normal pod-to-pod traffic matched by accident.
 *
 * The fix was to delete the host from the decision entirely and put the only
 * unauthenticated door behind an environment flag the operator sets by hand.
 * These tests are what stops it being reintroduced — including the one that
 * asserts you can no longer even pass a host to `decideAccess`.
 */

import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  decideAccess,
  isLocalHost,
  isPublicPath,
  localRequestsTrusted,
  SESSION_TTL_SECONDS,
  timingSafeEqual,
  TRUST_LOCAL_REQUESTS_ENV,
  verifySessionToken,
} from "./session";

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-10T12:00:00.000Z");

/** Every Host header that used to be a skeleton key. */
const FORGEABLE_LOCAL_HOSTS = [
  "localhost",
  "localhost:3000",
  "127.0.0.1:3000",
  "127.9.9.9:1",
  "[::1]",
  "[::1]:3000",
  "10.1.2.3",
  "192.168.1.175:3000",
  "172.16.5.9:3000",
];

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

  it("is still only a guess about a value the client controls", () => {
    // Kept as documentation of why this function may decorate a page but may
    // never gate one: the "evidence" it reasons about is typed by the caller.
    // Anyone, anywhere, can send this header against a public deployment.
    expect(isLocalHost("localhost")).toBe(true);
  });
});

describe("localRequestsTrusted", () => {
  it("is off when the flag is absent", () => {
    expect(localRequestsTrusted({})).toBe(false);
  });

  it('is on only for exactly "1"', () => {
    expect(localRequestsTrusted({ [TRUST_LOCAL_REQUESTS_ENV]: "1" })).toBe(true);
  });

  it("refuses every almost-yes, so a deployment cannot half-enable it", () => {
    for (const value of ["", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "11", "false"]) {
      expect(localRequestsTrusted({ [TRUST_LOCAL_REQUESTS_ENV]: value }), value).toBe(
        false,
      );
    }
  });

  it("is named one way, so a typo cannot read as off in one place and on in another", () => {
    expect(TRUST_LOCAL_REQUESTS_ENV).toBe("TRUST_LOCAL_REQUESTS");
  });
});

describe("isPublicPath", () => {
  it("lets the login screen and the health check through", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    // Next normalises these away, but a trailing slash must not change the
    // answer in the direction of locking people out of logging in.
    expect(isPublicPath("/login/")).toBe(true);
  });

  it("does not let a route that merely starts with a public name through", () => {
    // The old middleware matcher said `(?!login|api/health|...)`, a prefix
    // test: every one of these would have been served with no session and no
    // warning the day someone added the route.
    for (const path of [
      "/login-callback",
      "/logins",
      "/login/../profile",
      "/api/health-debug",
      "/api/healthz",
      "/favicon.icon-x",
      "/profile",
      "/",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
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

describe("decideAccess and the forged Host header", () => {
  it("refuses every host that used to be a skeleton key", async () => {
    // THE regression test. Each of these, sent to a deployment with the trust
    // flag off and no password set, returned a full page before the fix.
    for (const host of FORGEABLE_LOCAL_HOSTS) {
      expect(
        await decideAccess({
          trustLocal: localRequestsTrusted({ HOST: host, [TRUST_LOCAL_REQUESTS_ENV]: undefined }),
          token: undefined,
          password: null,
          now: NOW,
        }),
        host,
      ).toEqual({ allow: false, reason: "not-configured" });
    }
  });

  it("still refuses those hosts when a password IS configured", async () => {
    // The password-set deployment is the one that goes on the public
    // subdomain. A forged host must buy nothing there either.
    for (const host of FORGEABLE_LOCAL_HOSTS) {
      expect(
        await decideAccess({
          trustLocal: localRequestsTrusted({ HOST: host }),
          token: undefined,
          password: PASSWORD,
          now: NOW,
        }),
        host,
      ).toEqual({ allow: false, reason: "unauthenticated" });
    }
  });

  it("cannot be handed a host at all", () => {
    // Belt and braces, and the reason this is a type-level assertion rather
    // than a runtime one: the bypass came back the moment a request-derived
    // value was accepted as a parameter, so accepting one is now a compile
    // error. @ts-expect-error fails the build if the error ever stops
    // happening — i.e. if someone re-adds `host` to the options.
    const options: Parameters<typeof decideAccess>[0] = {
      // @ts-expect-error `host` is not part of the decision and must not be.
      host: "localhost",
      trustLocal: false,
      token: undefined,
      password: null,
    };
    expect(options.trustLocal).toBe(false);
  });

  it("ignores the trust flag's value in the request's own headers", async () => {
    // Someone will eventually try sending the flag as a header. The decision
    // reads process.env-shaped input only; there is no code path from a header
    // name to `trustLocal`.
    expect(
      await decideAccess({
        trustLocal: localRequestsTrusted({
          "x-trust-local-requests": "1",
          TRUST_LOCAL_REQUESTSX: "1",
        }),
        token: undefined,
        password: null,
      }),
    ).toEqual({ allow: false, reason: "not-configured" });
  });
});

describe("decideAccess", () => {
  it("lets everything through when the operator trusted this machine", async () => {
    // What localhost development looks like: TRUST_LOCAL_REQUESTS=1 in .env,
    // no password, no login screen.
    expect(
      await decideAccess({
        trustLocal: localRequestsTrusted({ [TRUST_LOCAL_REQUESTS_ENV]: "1" }),
        token: undefined,
        password: null,
      }),
    ).toEqual({ allow: true });
  });

  it("refuses everything when no password is configured and nothing is trusted", async () => {
    // The accident this exists to prevent: tunnelled or deployed with the
    // password never set.
    expect(
      await decideAccess({ trustLocal: false, token: undefined, password: null }),
    ).toEqual({ allow: false, reason: "not-configured" });
  });

  it("asks a request without a session to log in", async () => {
    expect(
      await decideAccess({ trustLocal: false, token: undefined, password: PASSWORD }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });

  it("lets a request with a valid session through", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(
      await decideAccess({ trustLocal: false, token, password: PASSWORD, now: NOW }),
    ).toEqual({ allow: true });
  });

  it("invalidates existing sessions when the password changes", async () => {
    const token = await createSessionToken("old password", NOW);
    expect(
      await decideAccess({
        trustLocal: false,
        token,
        password: "new password",
        now: NOW,
      }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });

  it("refuses an expired session rather than falling back to anything", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const later = new Date(NOW.getTime() + (SESSION_TTL_SECONDS + 60) * 1000);
    expect(
      await decideAccess({ trustLocal: false, token, password: PASSWORD, now: later }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });
});
