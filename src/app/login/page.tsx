/**
 * The login screen.
 *
 * Only ever seen from outside this machine — local requests never reach it.
 */

import { configuredPassword } from "@/lib/auth/session";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Internship Autopilot" };

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = one(params, "error");
  const next = one(params, "next") ?? "";
  const configured = configuredPassword() !== null;

  return (
    <main className="page login-page">
      <h1>Internship Autopilot</h1>
      <p className="lede">This copy is reachable from outside its own machine.</p>

      {error === "wrong" ? (
        <div className="notice notice-error">That password is not right.</div>
      ) : null}

      {error === "rate-limited" ? (
        <div className="notice notice-error">
          {/*
            The wait arrives in the URL, so it is clamped rather than printed:
            anything reachable from a query parameter is text an attacker
            chooses, and this page is the one place a stranger can reach.
          */}
          Too many wrong passwords. Wait about{" "}
          {Math.min(60, Math.max(1, Number(one(params, "wait")) || 15))} minutes
          and try again.
        </div>
      ) : null}

      {!configured ? (
        <div className="notice notice-error">
          No password is set, so there is nothing to sign in with. Set{" "}
          <code>APP_PASSWORD</code> in <code>.env</code> and restart.
        </div>
      ) : (
        <form className="stack" action={loginAction}>
          <input type="hidden" name="next" value={next} />
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit">Sign in</button>
          </div>
        </form>
      )}
    </main>
  );
}
