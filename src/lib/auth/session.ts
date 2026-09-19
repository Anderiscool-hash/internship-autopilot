/**
 * Single-user authentication.
 *
 * This app holds one person's real work authorization, citizenship, graduation
 * date, résumé history and Truth Ledger. On this machine that is fine — it is
 * their machine. The moment it is reachable from anywhere else, an unlocked
 * copy is a public read/write copy of all of that, so anything that is not a
 * local request has to prove it knows the password.
 *
 * Deliberately small: one password in the environment, one signed cookie, no
 * user table, no password reset, no third-party auth. There is exactly one
 * user and no way to sign up. Every extra concept here would be a lie about
 * what this app is.
 *
 * Uses Web Crypto rather than node:crypto because this code runs in Next's
 * middleware, which is not guaranteed a Node runtime.
 */

/** How long a session lasts before the password is needed again. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * The session cookie's name — and why there are two of them.
 *
 * `__Host-` is not decoration. It is a rule the BROWSER enforces: a cookie
 * whose name starts with `__Host-` is silently discarded unless it is Secure,
 * has `Path=/`, and carries NO `Domain` attribute. The last of those is the
 * one that matters here. Without it, any page able to set cookies for
 * `lagranfamiliagrocery.com` — a different app on the apex, a forgotten
 * subdomain, a stale CMS — can write `ia_session` with `Domain=.lagranfamilia
 * grocery.com`, and the browser will happily send that sibling's cookie to
 * this app on every request. It cannot forge a VALID token (it does not know
 * the password, and the token is signed), but it can overwrite the owner's
 * good cookie with a junk one and quietly sign them out over and over. With
 * the `__Host-` prefix that whole family of cross-host writes is impossible,
 * because the browser will not store a `__Host-` cookie that has a Domain.
 *
 * The catch, and the reason this is not simply a renamed constant: `__Host-`
 * REQUIRES Secure, and Secure cookies do not work over plain `http://` — which
 * is exactly how this app is opened on localhost during development. So the
 * name is chosen per request: prefixed when the connection is over TLS,
 * unprefixed when it is plain http to this machine. See `sessionCookieName`.
 *
 * `SESSION_COOKIE` keeps its old name and old value because other parts of the
 * app import it. Prefer `readSessionToken`, which checks both names.
 */
export const SESSION_COOKIE = "ia_session";

/** The hardened name, used whenever the connection is over TLS. */
export const SESSION_COOKIE_SECURE = `__Host-${SESSION_COOKIE}`;

/**
 * Both names, hardened first.
 *
 * Reading checks both and prefers the hardened one; writing picks exactly one;
 * logging out clears both. Clearing both is the part that is easy to forget
 * and expensive to get wrong: if a plain `ia_session` is left behind when the
 * app moves to https, it sits in the browser forever, is sent on every request
 * to this host, and is the one a sibling host could have written.
 */
export const SESSION_COOKIE_NAMES = [
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE,
] as const;

/**
 * Which cookie name to WRITE for this connection.
 *
 * True (TLS) gets the hardened name; false (plain http on this machine) gets
 * the plain one, because a `__Host-` cookie over http is thrown away by the
 * browser and the login would appear to succeed and then not stick.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

/**
 * Read the session token out of a cookie jar, whichever name it is under.
 *
 * Takes a reader function rather than a cookie jar because the two callers
 * hold different objects: the middleware has `request.cookies` and a server
 * action has the `cookies()` store from next/headers. Both can answer
 * "give me the value of the cookie called X".
 *
 * The hardened name wins when both are present. That ordering IS the defence:
 * if some sibling host has planted a domain-wide `ia_session`, the real
 * `__Host-` cookie is still the one that gets read.
 */
export function readSessionToken(
  read: (name: string) => string | undefined,
): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = read(name);
    if (value) return value;
  }
  return undefined;
}

/**
 * Is this request arriving over TLS — i.e. may the cookie be hardened?
 *
 * JUDGMENT CALL: this defaults to YES and only answers no for the single case
 * of plain http to this machine. The obvious implementation — "trust
 * `x-forwarded-proto`" — has the wrong failure direction: that header is
 * written by whatever is in front of the app, and a request that arrives with
 * `x-forwarded-proto: http` through a misconfigured proxy would then be handed
 * a non-Secure, unprefixed cookie on a public domain. Defaulting to secure
 * means the worst case of guessing wrong is a cookie the browser refuses to
 * store, which is loud, local and fixed in a second.
 *
 * Note that `isLocalHost` is used here, and `isLocalHost` reads a header the
 * client controls. That is safe HERE and nowhere else: the only thing a forged
 * `Host: localhost` buys is a weaker cookie issued to the forger's OWN
 * browser, and they had to know the password to be issued any cookie at all.
 * It cannot weaken the owner's cookie and it cannot let anyone in. This is the
 * "cosmetics and ergonomics" use that `isLocalHost`'s doc comment permits; it
 * is still never allowed to gate access.
 */
export function isSecureConnection(options: {
  /** The `x-forwarded-proto` header, if any. */
  proto: string | null;
  /** The `Host` header, if any. */
  host: string | null;
}): boolean {
  // A chain of proxies appends, so the first value is the original client's.
  const proto = options.proto?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  // Everything else — "http", nothing at all, something unrecognised — is
  // secure unless the host also looks like this machine.
  return !isLocalHost(options.host);
}

/**
 * Host strings that LOOK like this machine talking to itself, or the local
 * network. "Look like" is the whole caveat — see `isLocalHost`.
 */
const LOCAL_HOST_PATTERNS = [
  /^localhost(:\d+)?$/i,
  /^127\.\d+\.\d+\.\d+(:\d+)?$/,
  /^\[?::1\]?(:\d+)?$/,
  /^192\.168\.\d+\.\d+(:\d+)?$/,
  /^10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/,
];

/**
 * Does this host string look local?
 *
 * THIS IS NOT A SECURITY BOUNDARY. It must never gate access to anything.
 *
 * The only value ever passed here is the `Host:` header, which the client
 * writes and can set to whatever it likes. `curl -H "Host: localhost"` against
 * a public deployment returns true from this function. It used to be the first
 * line of `decideAccess`, which meant one forged header read the owner's name,
 * email, phone, work authorization and employment history off a deployed copy.
 * On a cloud host it was worse than forgeable: 10.x, 172.16–31.x and 192.168.x
 * ARE the internal network there, so ordinary pod-to-pod traffic matched
 * without anyone forging anything at all.
 *
 * What it is still fair for is cosmetics and ergonomics — whether to offer a
 * button that opens a browser window on the server's own screen, whether to
 * show a "you are viewing this remotely" hint. Getting those wrong costs a
 * misplaced button. If getting it wrong would expose data or run something
 * privileged, use `requireAccess` (or `decideAccess`), which read an explicit
 * environment flag that no request header can reach.
 */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host.trim()));
}

/** Constant-time string comparison, so a wrong password leaks nothing by timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  // Compare every character of the longer string either way: returning early
  // on a length mismatch would leak the password's length.
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** base64url without padding — safe in a cookie value. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // Returned as a plain ArrayBuffer: crypto.subtle wants a BufferSource whose
  // backing buffer is definitely not shared.
  return bytes.buffer;
}

/**
 * A fixed, application-specific salt for the key derivation below.
 *
 * A salt's job is to stop one precomputed table of "password → derived key"
 * from working against every application in the world. It does NOT need to be
 * secret — it is not a second password — and here it cannot be random, because
 * a random salt would have to be stored somewhere and there is nowhere to
 * store it: the token has to be verifiable by a process that just booted with
 * nothing but APP_PASSWORD in its environment. A constant unique to this app
 * is the right shape, and it is deliberately spelled out in the open.
 */
const KDF_SALT = new TextEncoder().encode("internship-autopilot/session/v2");

/**
 * PBKDF2 iteration count.
 *
 * High enough to be a real cost to someone guessing passwords offline, and
 * paid exactly once per process thanks to the cache below, so it does not
 * become per-request latency in the middleware.
 */
const KDF_ITERATIONS = 210_000;

/**
 * Derived keys, remembered per password for the life of the process.
 *
 * `verifySessionToken` runs in the middleware on EVERY request. Without this
 * cache, 210,000 hash iterations would be on the critical path of every page
 * load. The map is keyed by the password, which is already sitting in
 * `process.env` in the same process, so this stores nothing that was not
 * already there. It holds one entry in practice — there is one password.
 *
 * Promises, not keys, are cached: two requests arriving together then share
 * one derivation instead of racing to do the same expensive work twice.
 */
const derivedKeys = new Map<string, Promise<CryptoKey>>();

/**
 * Turn the password into an HMAC key via a real key-derivation function.
 *
 * Previously the password's raw bytes WERE the HMAC key. That works, in the
 * sense that the signature verifies, but it means the strength of every
 * session token is exactly the strength of whatever string the owner typed
 * into .env — a short or reused password is a short or reused key, with no
 * work factor in front of it at all. A KDF puts a deliberate, tunable cost
 * between "guess a password" and "test that guess".
 *
 * JUDGMENT CALL — PBKDF2 via Web Crypto rather than node:crypto's `scrypt`.
 * scrypt is the better KDF on the merits (it is memory-hard; PBKDF2 is not),
 * but this module is imported by `src/middleware.ts`, and Next runs middleware
 * on the Edge runtime, which does not provide `node:crypto`'s `scrypt` or
 * `scryptSync` — only Web Crypto. Importing node:crypto here would fail at
 * runtime on the deployment, so the guard on the door would be the thing that
 * broke. PBKDF2-HMAC-SHA256 at 210k iterations is the strongest KDF available
 * in both runtimes, is a documented OWASP setting, and needs no dependency.
 * This is the same reason the file uses Web Crypto throughout.
 */
function deriveKey(secret: string): Promise<CryptoKey> {
  const cached = derivedKeys.get(secret);
  if (cached) return cached;

  const derived = (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: KDF_SALT,
        iterations: KDF_ITERATIONS,
        hash: "SHA-256",
      },
      material,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  })();

  derivedKeys.set(secret, derived);
  return derived;
}

/**
 * Token format marker.
 *
 * Tokens now read `v2.<expiry>.<signature>`; they used to read
 * `<expiry>.<signature>`. The marker is part of the SIGNED payload, so it
 * cannot be edited off a token.
 *
 * ONE-TIME COST, ACCEPTED: adding the KDF changed the key, which changes every
 * signature, so every session that existed before this change is now invalid.
 * For a single-user app that means the owner signs in once more. There is no
 * migration path and deliberately no attempt at one — accepting old tokens
 * would mean keeping the raw-password key alive, which is the thing being
 * removed. The version marker exists so that an old token is recognised and
 * REJECTED cleanly as "not authenticated" (a redirect to the login screen)
 * rather than falling into some parse path that throws and turns into a 500.
 */
const TOKEN_VERSION = "v2";

/**
 * Mint a session token: an expiry, signed.
 *
 * The token carries no identity because there is only one user; all it says is
 * "someone knew the password, until this time". Signed with a key that comes
 * from the password through `deriveKey`, so changing the password invalidates
 * every existing session for free — and so that the key is the OUTPUT of a
 * key-derivation function rather than the password's own bytes.
 */
export async function createSessionToken(
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;

  const key = await deriveKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Check a session token. Returns false for anything not currently valid.
 *
 * Signature is verified before the expiry is trusted — the expiry is part of
 * the signed payload, so an unsigned token claiming a far-future expiry must
 * fail on the signature, not be read at all.
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // The shape test, which is also the old-token test. A pre-KDF token is
  // `<digits>.<signature>`, so its payload is bare digits with no version
  // marker and it fails here — returning false, which the callers read as
  // "not authenticated" and turn into a redirect to the login screen. It does
  // not reach the crypto below, so there is nothing here that could throw and
  // become a 500 for someone who merely has a stale cookie.
  const expiry = payload.startsWith(`${TOKEN_VERSION}.`)
    ? payload.slice(TOKEN_VERSION.length + 1)
    : null;
  if (expiry === null || !/^\d+$/.test(expiry)) return false;

  let signatureBytes: ArrayBuffer;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    return false;
  }

  const key = await deriveKey(secret);
  // `crypto.subtle.verify` is the timing-safe comparison: it compares the two
  // MACs internally without leaking where they diverged. Doing this by hand —
  // signing and then comparing strings with `===` — is what this avoids.
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!valid) return false;

  return Number(expiry) > Math.floor(now.getTime() / 1000);
}

/** The configured password, or null when none is set. */
export function configuredPassword(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const password = env.APP_PASSWORD;
  return typeof password === "string" && password.length > 0 ? password : null;
}

/**
 * The environment variable that turns the password off for a whole deployment.
 *
 * Named once, here, so that the flag cannot be half-spelled somewhere and
 * silently read as "off" in one place and "on" in another.
 */
export const TRUST_LOCAL_REQUESTS_ENV = "TRUST_LOCAL_REQUESTS";

/**
 * Has the operator explicitly said "this copy is not reachable from anywhere,
 * don't ask me for a password"?
 *
 * Only the exact string "1" counts. Not "true", not "yes", not "0", not the
 * empty string — an empty or missing variable is the default, and the default
 * is off. Deciding this from the environment rather than from the request is
 * the entire point: a person with shell access to the server can set it, and
 * nobody else can, no matter what headers they send.
 *
 * On your own laptop, put TRUST_LOCAL_REQUESTS=1 in .env and the app behaves
 * exactly as it always has. Leave it out of the deployment's environment and
 * every request there has to know the password.
 */
export function localRequestsTrusted(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[TRUST_LOCAL_REQUESTS_ENV] === "1";
}

/**
 * The only paths that have to work before anyone can possibly be logged in:
 * the login screen (a login behind a login is a redirect loop) and the health
 * endpoint (a load balancer cannot type a password, and that route reveals
 * nothing beyond up/down and a row count).
 *
 * Exact paths, not prefixes. The previous version of this lived in the
 * middleware matcher as `(?!login|api/health)`, which is a PREFIX test, so a
 * route added later called /login-callback or /api/health-debug would have
 * been unauthenticated and nothing would have said so.
 */
const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

/** Is this exact path one of the few that is deliberately unauthenticated? */
export function isPublicPath(pathname: string): boolean {
  // Next normalises "/login/" to "/login" before we see it, but a path that
  // arrives with a trailing slash should not accidentally become private.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return PUBLIC_PATHS.has(normalized);
}

/** What a request is allowed to do. */
export type AccessDecision =
  /** Trusted-local deployment, or a valid session: let it through. */
  | { allow: true }
  /** Remote request with no password configured — refuse, and say why. */
  | { allow: false; reason: "not-configured" }
  /** Remote request that needs to log in. */
  | { allow: false; reason: "unauthenticated" };

/**
 * Decide whether a request may proceed.
 *
 * Look at what is not a parameter: nothing the client sent except the cookie,
 * and the cookie is only believed after its signature verifies. There is no
 * host, no forwarded-for, no origin. The one way to get `{allow:true}` without
 * a valid session is `trustLocal`, which the caller must read from the
 * server's own environment via `localRequestsTrusted` — a value no header,
 * query string or hostname can influence. That is the property this function
 * exists to hold, and a parameter of the shape `host: string | null` is how it
 * was lost the first time.
 *
 * The "not-configured" case is deliberately a refusal rather than a warning.
 * A deployment with no password set and no explicit trust flag is the exact
 * accident this exists to prevent, and a banner saying so on a page that
 * already showed the data would be pointless.
 */
export async function decideAccess(options: {
  /** From `localRequestsTrusted(process.env)`. Never from the request. */
  trustLocal: boolean;
  token: string | undefined;
  password: string | null;
  now?: Date;
}): Promise<AccessDecision> {
  if (options.trustLocal) return { allow: true };

  if (options.password === null) return { allow: false, reason: "not-configured" };

  const valid = await verifySessionToken(
    options.token,
    options.password,
    options.now,
  );
  return valid ? { allow: true } : { allow: false, reason: "unauthenticated" };
}

/* ------------------------------------------------------------------------ *
 * Login rate limiting
 *
 * `loginAction` guards a single shared password and, once this is on a public
 * subdomain, anyone on the internet can POST to it as fast as they like. With
 * no limiter, "one password" means "one password and unlimited guesses", which
 * is a materially different thing.
 *
 * IN-MEMORY ON PURPOSE, AND HERE IS WHAT THAT MEANS. The state below is a
 * plain object in this process's memory. It therefore does NOT survive:
 *
 *   - a restart or redeploy (the counter goes back to zero);
 *   - more than one instance (each copy counts its own attempts, so N
 *     instances allow N times the guesses).
 *
 * Both are acceptable for what this actually is: one person, one process, one
 * password, on one small box. Fixing either means a shared store — Redis, or a
 * table and a write on every failed login — and that is a real piece of
 * infrastructure to run and back up in exchange for slowing down an attacker
 * who is already being slowed down. If this ever runs multi-instance, this
 * comment is the note saying the limiter quietly got weaker.
 * ------------------------------------------------------------------------ */

/** Failed attempts allowed before the door closes. */
export const LOGIN_MAX_FAILURES = 5;

/** How long the door stays closed, and how long the counter lives. */
export const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes

/**
 * The counter. One bucket, not one per IP.
 *
 * JUDGMENT CALL: there is no per-IP keying because there is nothing here that
 * can honestly identify a client. The only candidate is `x-forwarded-for`,
 * which the client writes; an attacker rotates it per request and gets
 * unlimited attempts while the owner, whose IP is stable, is the only person
 * the limiter ever actually limits. A single global bucket is weaker against
 * nothing and stronger against that.
 *
 * The cost of one bucket is honest and worth stating: someone hammering wrong
 * passwords can keep the owner locked out while they are hammering. That is a
 * nuisance, not a breach, and it is bounded — see `checkLoginAllowed`.
 */
export interface LoginAttempts {
  /** Failures counted so far in the current window. */
  failures: number;
  /** When the current window began, in milliseconds. */
  windowStartedAt: number;
}

/** A fresh counter. Exported so tests get their own instead of sharing one. */
export function createLoginAttempts(): LoginAttempts {
  return { failures: 0, windowStartedAt: 0 };
}

/** Whether the door is open, and if not, how long until it is. */
export type LoginRateVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * May someone try a password right now?
 *
 * A FIXED window, not a sliding one, and that choice is the answer to "can
 * this lock the owner out permanently?". A sliding window counts the last N
 * failures however old the window gets, so an attacker sending one guess a
 * minute forever keeps the window permanently full and the owner permanently
 * out. A fixed window expires as a whole: once `LOGIN_WINDOW_SECONDS` have
 * passed since the window opened, the counter resets to zero no matter what
 * else is happening, so there is always a fresh set of attempts available
 * shortly. The worst an attacker can do is make the owner wait.
 *
 * Pure: it is handed the state and the clock, so the tests do not need to
 * wait fifteen real minutes to see the recovery.
 */
export function checkLoginAllowed(
  state: LoginAttempts,
  now: Date = new Date(),
): LoginRateVerdict {
  const elapsed = (now.getTime() - state.windowStartedAt) / 1000;

  // Window is over: wipe it. Done on read as well as on write so that a
  // process which has been idle for an hour is not still holding a grudge.
  if (elapsed >= LOGIN_WINDOW_SECONDS) {
    state.failures = 0;
    state.windowStartedAt = 0;
    return { allowed: true };
  }

  if (state.failures < LOGIN_MAX_FAILURES) return { allowed: true };

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(LOGIN_WINDOW_SECONDS - elapsed)),
  };
}

/** Count a wrong password. Only wrong ones — a correct password is not traffic to punish. */
export function recordLoginFailure(
  state: LoginAttempts,
  now: Date = new Date(),
): void {
  const elapsed = (now.getTime() - state.windowStartedAt) / 1000;
  if (elapsed >= LOGIN_WINDOW_SECONDS) {
    // First failure of a new window.
    state.failures = 1;
    state.windowStartedAt = now.getTime();
    return;
  }
  state.failures += 1;
}

/**
 * Forget the failures. Called after a successful login, so the owner
 * fat-fingering the password four times and then getting it right does not
 * leave them one typo away from a lockout for the next quarter of an hour.
 */
export function clearLoginFailures(state: LoginAttempts): void {
  state.failures = 0;
  state.windowStartedAt = 0;
}

/**
 * The process-wide counter that `loginAction` actually uses.
 *
 * Module scope, so it is shared by every request this process serves — which
 * is the whole point — and so it dies with the process, as described above.
 */
export const loginAttempts = createLoginAttempts();
