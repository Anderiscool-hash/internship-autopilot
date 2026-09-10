/**
 * The lock on the door.
 *
 * Runs before every page and server action. Local requests pass straight
 * through; anything reachable from outside this machine has to present a valid
 * session cookie, and if no password has been configured at all, remote
 * requests are refused outright rather than served.
 *
 * Being middleware rather than a check inside each page matters: a new route
 * added later is protected by existing, whereas a per-page guard is protection
 * you have to remember. The failure mode of forgetting here is a locked door,
 * not an open one.
 */

import { NextResponse, type NextRequest } from "next/server";
import { configuredPassword, decideAccess, SESSION_COOKIE } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const decision = await decideAccess({
    host: request.headers.get("host"),
    token: request.cookies.get(SESSION_COOKIE)?.value,
    password: configuredPassword(),
  });

  if (decision.allow) return NextResponse.next();

  if (decision.reason === "not-configured") {
    return new NextResponse(
      "This app is reachable from outside its own machine but has no password set.\n\n" +
        "It holds personal data — work authorization, graduation date, résumé history — so it will not serve\n" +
        "remote requests unlocked.\n\n" +
        "Set APP_PASSWORD in .env and restart to unlock it.",
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
   * Everything except the login screen itself, Next's own assets, and the
   * favicon — a login page behind a login is a redirect loop, and blocking the
   * stylesheet would serve an unstyled login form.
   */
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
