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

export const SESSION_COOKIE = "ia_session";

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

/** HMAC key derived from the password itself — no second secret to manage. */
async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Mint a session token: an expiry, signed.
 *
 * The token carries no identity because there is only one user; all it says is
 * "someone knew the password, until this time". Signed with a key derived from
 * the password, so changing the password invalidates every existing session
 * for free.
 */
export async function createSessionToken(
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);

  const key = await importKey(secret);
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
  if (!/^\d+$/.test(payload)) return false;

  let signatureBytes: ArrayBuffer;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    return false;
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!valid) return false;

  return Number(payload) > Math.floor(now.getTime() / 1000);
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
