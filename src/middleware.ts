/**
 * The lock on the door.
 *
 * Runs before every page. Unless the operator has explicitly set
 * TRUST_LOCAL_REQUESTS=1 in the server's own environment, a request has to
 * present a valid session cookie, and if no password has been configured at
 * all, requests are refused outright rather than served.
 *
 * What it deliberately does NOT do is look at the request to decide whether
 * the request is trusted. It used to: it read the `Host:` header, matched it
 * against /^localhost/, /^10\./ and friends, and allowed anything that looked
 * local. The client writes that header. `curl -H "Host: localhost"` was a full
 * bypass of this file, and on a cloud host the private-range patterns matched
 * ordinary internal traffic without anyone forging anything.
 *
 * Being middleware rather than a check inside each page matters for pages: a
 * new route added later is protected by existing. It is not enough for server
 * actions, which Next dispatches by action ID rather than by route and which
 * can therefore be aimed at an unmatched path — those call `requireAccess()`
 * from lib/auth/guard themselves, and this file is their second lock.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  configuredPassword,
  decideAccess,
  isPublicPath,
  localRequestsTrusted,
  SESSION_COOKIE,
} from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  // The login screen and the health check, by exact path. Keeping this test in
  // code rather than in the matcher below is what makes it an exact test: the
  // matcher's negative lookahead was a prefix match, so /login-callback would
  // have been public and nobody would have noticed.
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const decision = await decideAccess({
    trustLocal: localRequestsTrusted(),
    token: request.cookies.get(SESSION_COOKIE)?.value,
    password: configuredPassword(),
  });

  if (decision.allow) return NextResponse.next();

  if (decision.reason === "not-configured") {
    return new NextResponse(
      "This app has no password set and local requests are not trusted, so it will not serve anything.\n\n" +
        "It holds personal data — work authorization, graduation date, résumé history — so it will not serve\n" +
        "requests unlocked.\n\n" +
        "Set APP_PASSWORD in .env and restart to unlock it with a password.\n\n" +
        "On a machine that is genuinely not reachable from anywhere else — your own laptop — set\n" +
        "TRUST_LOCAL_REQUESTS=1 in .env instead and restart, and no password is needed. Never set that\n" +
        "on a deployment: it turns authentication off for everyone who can reach the app.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Send them to the login screen, remembering where they were headed.
  const login = new URL("/login", request.url);
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== "/" && !target.startsWith("/login")) {
    login.searchParams.set("next", target);
  }
  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Everything except Next's own assets — blocking the stylesheet would serve
   * an unstyled login form, and these are the one set of paths where a prefix
   * match is the honest description: /_next/static/ really is a directory.
   *
   * The login screen and /api/health are NOT excluded here. They are allowed
   * inside the function above, by exact path, because "starts with login" is
   * a different and much looser statement than "is /login" and this file
   * should not be making the looser one.
   */
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"],
};
