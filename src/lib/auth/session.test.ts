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
  checkLoginAllowed,
  clearLoginFailures,
  createLoginAttempts,
  createSessionToken,
  decideAccess,
  isLocalHost,
  isPublicPath,
  isSecureConnection,
  localRequestsTrusted,
  loginAttempts,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SECONDS,
  readSessionToken,
  recordLoginFailure,
  SESSION_COOKIE,
  SESSION_COOKIE_NAMES,
  SESSION_COOKIE_SECURE,
  sessionCookieName,
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

/* ------------------------------------------------------------------------ *
 * The public-deployment hardening: cookie prefix, key derivation, and the
 * login limiter. Each of these is invisible on localhost and load-bearing the
 * moment the app answers on a public subdomain.
 * ------------------------------------------------------------------------ */

/**
 * Mint a token EXACTLY the way the app used to, before the KDF: HMAC-SHA256
 * with the raw password bytes as the key, over a bare numeric expiry with no
 * version marker.
 *
 * Deliberately a copy of the deleted code rather than a call into the module,
 * because the point is to keep a specimen of the old format around after the
 * code that produced it is gone.
 */
async function legacySessionToken(secret: string, now: Date): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  const base64url = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payload}.${base64url}`;
}

describe("key derivation", () => {
  it("round-trips a token minted with the derived key", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(await verifySessionToken(token, PASSWORD, NOW)).toBe(true);
  });

  it("stamps the token with a version so its format is not a guess", async () => {
    // `v2.<expiry>.<signature>`. The marker is inside the signed payload, so
    // it cannot be edited off the front of a token.
    const token = await createSessionToken(PASSWORD, NOW);
    expect(token.startsWith("v2.")).toBe(true);
    const expiry = token.split(".")[1];
    expect(Number(expiry)).toBe(
      Math.floor(NOW.getTime() / 1000) + SESSION_TTL_SECONDS,
    );
  });

  it("no longer signs with the raw password, so the format really did change", async () => {
    // If someone removes the KDF and goes back to importing the password as a
    // key, these two become equal and this test fails.
    const current = await createSessionToken(PASSWORD, NOW);
    const legacy = await legacySessionToken(PASSWORD, NOW);
    expect(current).not.toBe(legacy);
  });

  it("rejects a token made the OLD way, cleanly, without throwing", async () => {
    // Every session that existed before the KDF landed is now invalid. That is
    // accepted -- one person, one re-login -- but it has to look like "not
    // signed in" and land on the login screen, NOT like a crash. A `false`
    // here becomes a redirect; an exception here would be a 500 for anyone who
    // still had yesterday's cookie in their browser.
    const legacy = await legacySessionToken(PASSWORD, NOW);

    let result: boolean | undefined;
    let threw: unknown;
    try {
      result = await verifySessionToken(legacy, PASSWORD, NOW);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeUndefined();
    expect(result).toBe(false);

    // And the same through the entry point an old cookie actually hits.
    expect(
      await decideAccess({
        trustLocal: false,
        token: legacy,
        password: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });

  it("rejects a v2-looking token whose signature came from the old key", async () => {
    // The specific near-miss: someone splices the version marker onto an old
    // token. The marker is part of what is signed, so the signature no longer
    // covers the payload and verification fails.
    const legacy = await legacySessionToken(PASSWORD, NOW);
    expect(await verifySessionToken(`v2.${legacy}`, PASSWORD, NOW)).toBe(false);
  });

  it("still refuses junk, an edited expiry and the wrong password", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);

    expect(await verifySessionToken(`v2.9999999999.${signature}`, PASSWORD, NOW)).toBe(
      false,
    );
    expect(await verifySessionToken(token, "different password", NOW)).toBe(false);
    for (const junk of ["v2.", "v2..", "v2.abc.def", "v2", "v3.123.abc", "1.!!!"]) {
      expect(await verifySessionToken(junk, PASSWORD, NOW), junk).toBe(false);
    }
  });
});

describe("the session cookie name", () => {
  it("is prefixed only when the connection is secure", () => {
    expect(sessionCookieName(true)).toBe("__Host-ia_session");
    expect(sessionCookieName(false)).toBe("ia_session");
  });

  it("keeps the unprefixed name for plain http, because __Host- needs Secure", () => {
    // A `__Host-` cookie without Secure is discarded by the browser, so using
    // the prefix on localhost http would mean logins that never stick.
    expect(sessionCookieName(false).startsWith("__Host-")).toBe(false);
  });

  it("lists both names with the hardened one first", () => {
    expect([...SESSION_COOKIE_NAMES]).toEqual(["__Host-ia_session", "ia_session"]);
    expect(SESSION_COOKIE).toBe("ia_session");
    expect(SESSION_COOKIE_SECURE).toBe("__Host-ia_session");
  });

  it("reads the hardened cookie in preference to a plantable one", () => {
    // The attack the prefix exists to stop: a sibling host on the same parent
    // domain writes `ia_session` with a Domain attribute. It cannot write a
    // `__Host-` cookie, so the real session must be the one that is read.
    const jar: Record<string, string> = {
      "__Host-ia_session": "the real session",
      ia_session: "planted by a sibling host",
    };
    expect(readSessionToken((name) => jar[name])).toBe("the real session");
  });

  it("still finds the plain cookie when that is the only one there", () => {
    expect(
      readSessionToken((name) => (name === "ia_session" ? "local" : undefined)),
    ).toBe("local");
    expect(readSessionToken(() => undefined)).toBeUndefined();
    // An empty cookie is not a session.
    expect(readSessionToken(() => "")).toBeUndefined();
  });
});

describe("isSecureConnection", () => {
  it("is true for a TLS request", () => {
    expect(
      isSecureConnection({ proto: "https", host: "jobs.example-public.com" }),
    ).toBe(true);
    // Proxy chains append; the first entry is the original client's.
    expect(isSecureConnection({ proto: "https,http", host: "example.com" })).toBe(true);
  });

  it("is false only for plain http to this machine", () => {
    expect(isSecureConnection({ proto: "http", host: "localhost:3000" })).toBe(false);
    expect(isSecureConnection({ proto: null, host: "127.0.0.1:3000" })).toBe(false);
  });

  it("defaults to secure when the proxy header is missing or lying", () => {
    // The failure direction that matters: a forged or misconfigured
    // `x-forwarded-proto: http` on a public host must NOT downgrade the
    // cookie. Getting this wrong the other way costs a login that visibly does
    // not stick; getting it wrong this way ships the session in clear text.
    expect(isSecureConnection({ proto: "http", host: "jobs.example-public.com" })).toBe(
      true,
    );
    expect(isSecureConnection({ proto: null, host: "example-public.com" })).toBe(true);
    expect(isSecureConnection({ proto: "gopher", host: "example.com" })).toBe(true);
    expect(isSecureConnection({ proto: null, host: null })).toBe(true);
  });

  it("a forged local Host buys the forger a weaker cookie and nothing else", async () => {
    // `isLocalHost` reads a client-controlled header, so this IS forgeable --
    // and it is harmless here, unlike in `decideAccess`. All it changes is the
    // cookie issued to the forger's own browser, and they needed the password
    // to be issued one at all. It cannot touch the owner's cookie.
    expect(isSecureConnection({ proto: "http", host: "localhost" })).toBe(false);

    // The gate that actually decides access is untouched by the same forgery:
    // a request claiming to be localhost still has to log in.
    expect(
      await decideAccess({
        trustLocal: localRequestsTrusted({ HOST: "localhost" }),
        token: undefined,
        password: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ allow: false, reason: "unauthenticated" });
  });
});

describe("login rate limiting", () => {
  // Every test gets its own counter. The module-level `loginAttempts` is
  // shared by the whole process by design, and must not be what tests poke at.
  const at = (secondsFromNow: number) =>
    new Date(NOW.getTime() + secondsFromNow * 1000);

  it("allows attempts up to the limit, then refuses", () => {
    const state = createLoginAttempts();

    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(checkLoginAllowed(state, NOW), `attempt ${attempt}`).toEqual({
        allowed: true,
      });
      recordLoginFailure(state, NOW);
    }

    const refused = checkLoginAllowed(state, NOW);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_WINDOW_SECONDS);
    }
  });

  it("recovers on its own once the window is over", () => {
    const state = createLoginAttempts();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      recordLoginFailure(state, NOW);
    }
    expect(checkLoginAllowed(state, NOW).allowed).toBe(false);

    // A second before the window closes: still shut.
    expect(checkLoginAllowed(state, at(LOGIN_WINDOW_SECONDS - 1)).allowed).toBe(false);
    // A second after: open, with a clean slate.
    expect(checkLoginAllowed(state, at(LOGIN_WINDOW_SECONDS + 1))).toEqual({
      allowed: true,
    });
    expect(state.failures).toBe(0);
  });

  it("cannot lock the owner out permanently", () => {
    // A FIXED window, not a sliding one, is what guarantees this. Under a
    // sliding window an attacker guessing once a minute forever would keep the
    // window permanently full and the owner permanently out. Here the window
    // expires as a whole, so however long the attack runs, attempts become
    // available again every window.
    const state = createLoginAttempts();
    let clock = 0;

    for (let round = 0; round < 10; round += 1) {
      let openedThisRound = false;
      for (let attempt = 0; attempt < LOGIN_MAX_FAILURES * 3; attempt += 1) {
        clock += 60; // an attacker guessing once a minute, forever
        if (checkLoginAllowed(state, at(clock)).allowed) {
          openedThisRound = true;
          recordLoginFailure(state, at(clock));
        }
      }
      expect(openedThisRound, `round ${round}`).toBe(true);
    }
  });

  it("counts down truthfully, so the message can say how long to wait", () => {
    const state = createLoginAttempts();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      recordLoginFailure(state, NOW);
    }

    const immediately = checkLoginAllowed(state, NOW);
    const halfway = checkLoginAllowed(state, at(LOGIN_WINDOW_SECONDS / 2));
    expect(immediately.allowed).toBe(false);
    expect(halfway.allowed).toBe(false);
    if (!immediately.allowed && !halfway.allowed) {
      expect(immediately.retryAfterSeconds).toBe(LOGIN_WINDOW_SECONDS);
      expect(halfway.retryAfterSeconds).toBe(LOGIN_WINDOW_SECONDS / 2);
    }
  });

  it("forgets the failures after a successful login", () => {
    // Four typos and then the right password must not leave the owner one
    // mistake away from a lockout for the next quarter of an hour.
    const state = createLoginAttempts();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES - 1; attempt += 1) {
      recordLoginFailure(state, NOW);
    }
    clearLoginFailures(state);
    expect(state.failures).toBe(0);

    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(checkLoginAllowed(state, NOW).allowed).toBe(true);
      recordLoginFailure(state, NOW);
    }
    expect(checkLoginAllowed(state, NOW).allowed).toBe(false);
  });

  it("starts a fresh window when a failure arrives long after the last one", () => {
    const state = createLoginAttempts();
    recordLoginFailure(state, NOW);
    recordLoginFailure(state, at(LOGIN_WINDOW_SECONDS + 60));
    expect(state.failures).toBe(1);
  });

  it("ships with a limit and a window a person would recognise", () => {
    // Loose bounds on purpose -- this is here so that tuning the numbers is a
    // deliberate edit, not so that they can never change.
    expect(LOGIN_MAX_FAILURES).toBeGreaterThanOrEqual(3);
    expect(LOGIN_MAX_FAILURES).toBeLessThanOrEqual(10);
    expect(LOGIN_WINDOW_SECONDS).toBeGreaterThanOrEqual(60);
    expect(LOGIN_WINDOW_SECONDS).toBeLessThanOrEqual(60 * 60);
  });

  it("starts the process-wide counter empty", () => {
    // In-memory and process-wide on purpose. It does not survive a restart and
    // it is not shared between instances -- see the comment on `loginAttempts`.
    expect(loginAttempts.failures).toBeGreaterThanOrEqual(0);
    expect(checkLoginAllowed(loginAttempts, NOW).allowed).toBe(true);
  });
});
