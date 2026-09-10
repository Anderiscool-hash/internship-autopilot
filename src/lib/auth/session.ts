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

/** Hosts that are this machine talking to itself, or the local network. */
const LOCAL_HOST_PATTERNS = [
  /^localhost(:\d+)?$/i,
  /^127\.\d+\.\d+\.\d+(:\d+)?$/,
  /^\[?::1\]?(:\d+)?$/,
  /^192\.168\.\d+\.\d+(:\d+)?$/,
  /^10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/,
];

/**
 * Is this request coming from the machine or the home network?
 *
 * Local requests skip the password entirely: needing to log in to your own
 * laptop to look at your own job list is friction with no security benefit,
 * and it would tempt the obvious workaround of disabling auth altogether.
 *
 * Anything else — a tunnel, a deployment, a domain — is remote and must
 * authenticate, whether or not a password has been configured.
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

/** What a request is allowed to do. */
export type AccessDecision =
  /** Local request, or a valid session: let it through. */
  | { allow: true }
  /** Remote request with no password configured — refuse, and say why. */
  | { allow: false; reason: "not-configured" }
  /** Remote request that needs to log in. */
  | { allow: false; reason: "unauthenticated" };

/**
 * Decide whether a request may proceed.
 *
 * The "not-configured" case is deliberately a refusal rather than a warning.
 * A remote deployment with no password set is the exact accident this exists
 * to prevent, and a banner saying so on a page that already showed the data
 * would be pointless.
 */
export async function decideAccess(options: {
  host: string | null;
  token: string | undefined;
  password: string | null;
  now?: Date;
}): Promise<AccessDecision> {
  if (isLocalHost(options.host)) return { allow: true };

  if (options.password === null) return { allow: false, reason: "not-configured" };

  const valid = await verifySessionToken(
    options.token,
    options.password,
    options.now,
  );
  return valid ? { allow: true } : { allow: false, reason: "unauthenticated" };
}
