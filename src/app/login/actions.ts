"use server";

/**
 * The login form's action.
 *
 * One password, compared in constant time, and a signed cookie on success.
 * Nothing is stored server-side: the cookie itself carries a signed expiry,
 * which is all a single-user app needs to know.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  configuredPassword,
  createSessionToken,
  SESSION_COOKIE,
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

  if (typeof submitted !== "string" || !timingSafeEqual(submitted, password)) {
    // No detail about what was wrong — there is one field and one answer, and
    // "wrong password" is the whole of what a legitimate user needs.
    redirect("/login?error=wrong");
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    // Set only over HTTPS in production so the cookie cannot travel in clear
    // text; left off locally, where there is no certificate.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  const destination = typeof next === "string" && next.startsWith("/") ? next : "/jobs";
  redirect(destination);
}

/** Sign out: drop the cookie. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
