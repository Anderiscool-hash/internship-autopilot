"use server";

/**
 * The login form's action.
 *
 * One password, compared in constant time, and a signed cookie on success.
 * Nothing is stored server-side: the cookie itself carries a signed expiry,
 * which is all a single-user app needs to know.
 *
 * Two things here are about being reachable from the public internet rather
 * than from a laptop: the cookie is hardened with the `__Host-` prefix when
 * the connection is over TLS, and wrong passwords are counted so that "one
 * shared password" does not also mean "unlimited guesses".
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkLoginAllowed,
  clearLoginFailures,
  configuredPassword,
  createSessionToken,
  isSecureConnection,
  loginAttempts,
  recordLoginFailure,
  SESSION_COOKIE_NAMES,
  sessionCookieName,
  SESSION_TTL_SECONDS,
  timingSafeEqual,
} from "@/lib/auth/session";

export async function loginAction(form: FormData): Promise<void> {
  const submitted = form.get("password");
  const next = form.get("next");
  const password = configuredPassword();

  if (password === null) {
    redirect("/login?error=not-configured");
  }

  // The limiter runs BEFORE the password is looked at. Checking it afterwards
  // would still let an attacker measure whether each guess was right, which is
  // the only thing they wanted from the request.
  const verdict = checkLoginAllowed(loginAttempts);
  if (!verdict.allowed) {
    // Whole minutes, rounded up, as a number — not a sentence. The login page
    // builds the sentence around it. Anything put in a query string comes back
    // from whoever asked for the page, so the only thing worth passing is a
    // value that is meaningless unless the page already knows what it means.
    const minutes = Math.max(1, Math.ceil(verdict.retryAfterSeconds / 60));
    redirect(`/login?error=rate-limited&wait=${minutes}`);
  }

  if (typeof submitted !== "string" || !timingSafeEqual(submitted, password)) {
    recordLoginFailure(loginAttempts);
    // No detail about what was wrong — there is one field and one answer, and
    // "wrong password" is the whole of what a legitimate user needs.
    redirect("/login?error=wrong");
  }

  // Right password: forget the failures. The owner mistyping four times and
  // then getting it right should not be left one typo from a lockout, and
  // successful logins are never what a limiter is meant to be slowing down.
  clearLoginFailures(loginAttempts);

  const requestHeaders = await headers();
  const secure = isSecureConnection({
    proto: requestHeaders.get("x-forwarded-proto"),
    host: requestHeaders.get("host"),
  });

  const store = await cookies();
  store.set(sessionCookieName(secure), await createSessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    // Decided from the connection, not from NODE_ENV. Those are different
    // questions: NODE_ENV says how the code was built, and the thing that
    // matters is whether THIS request travelled over TLS. Keyed on NODE_ENV,
    // a TLS-terminating proxy in front of an app started without the variable
    // shipped the whole session in clear text while looking configured.
    //
    // `isSecureConnection` answers true by default and false only for plain
    // http to this machine, so the fallback direction is the safe one: a wrong
    // guess yields a cookie the browser refuses to store, which is a login
    // that visibly does not stick — found in seconds — rather than a session
    // quietly readable on the wire.
    //
    // This and the cookie NAME move together on purpose. `__Host-` cookies are
    // rejected by the browser unless they are Secure, Path=/ and have no
    // Domain, so `sessionCookieName(secure)` and `secure` have to agree or the
    // browser silently drops the cookie.
    secure,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  const destination = typeof next === "string" && next.startsWith("/") ? next : "/jobs";
  redirect(destination);
}

/** Sign out: drop the cookie — both possible names of it. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();

  // BOTH names, always. A browser that logged in over http on localhost and
  // later over https holds two cookies; clearing only the one this request
  // would have written leaves the other sitting there, still valid, still sent
  // on every request — a sign-out that did not sign anyone out.
  for (const name of SESSION_COOKIE_NAMES) {
    const hardened = name.startsWith("__Host-");
    // Written as an expiring `set` rather than `delete` because a deletion is
    // itself a Set-Cookie, and the browser applies the `__Host-` rules to it
    // too: a deletion for `__Host-ia_session` that is not Secure with Path=/
    // is discarded, and the cookie it was meant to remove survives.
    store.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: hardened,
      maxAge: 0,
      path: "/",
    });
  }

  redirect("/login");
}
