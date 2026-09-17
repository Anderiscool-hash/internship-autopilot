/**
 * Tests for the per-action lock.
 *
 * The middleware protects routes. Server actions are not routes: Next picks
 * one by the action ID in the request headers, so an action can be invoked by
 * POSTing its ID to any URL — including /login, which the matcher has to let
 * past or nobody could ever log in. That was demonstrated against the running
 * app: a POST to /login carrying a profile action's ID ran that action's body,
 * with no cookie and no middleware, while a made-up ID returned 404. So every
 * action calls `requireAccess()` first.
 *
 * What these tests pin down is the shape of the failure, because that is the
 * part that decides whether forgetting is safe:
 *
 *   - a denial THROWS, so there is no verdict a caller can neglect to read;
 *   - the throw is a plain Error, which Next turns into a server error rather
 *     than a rendered page or a redirect that reads as success;
 *   - `allow: true` returns quietly, so a logged-in owner is not locked out.
 *
 * `requireAccess` itself reads `cookies()` from next/headers and so needs a
 * request; nothing in this repo mocks, and rather than start here the decision
 * half is a pure function, `assertAccessAllowed`, and that is what is tested.
 * What is left in `requireAccess` is three reads with no branches.
 */

import { describe, it, expect } from "vitest";
import { AccessDeniedError, assertAccessAllowed } from "./guard";
import { decideAccess, localRequestsTrusted, TRUST_LOCAL_REQUESTS_ENV } from "./session";

describe("assertAccessAllowed", () => {
  it("returns quietly when access is allowed", () => {
    expect(() => assertAccessAllowed({ allow: true })).not.toThrow();
  });

  it("throws rather than returning a verdict a caller could ignore", () => {
    // The signature is `void`, so there is nothing to check and nothing to
    // forget to check. If this ever becomes a boolean, every action in the app
    // is one missing `if` away from running for a stranger.
    const returned: void = assertAccessAllowed({ allow: true });
    expect(returned).toBeUndefined();

    expect(() =>
      assertAccessAllowed({ allow: false, reason: "unauthenticated" }),
    ).toThrow(AccessDeniedError);
    expect(() =>
      assertAccessAllowed({ allow: false, reason: "not-configured" }),
    ).toThrow(AccessDeniedError);
  });

  it("throws a real Error, which Next cannot render as a successful action", () => {
    // Deliberately not a redirect: a redirect is a 2xx/3xx the client treats
    // as the action having worked. An Error rejects the action.
    let thrown: unknown;
    try {
      assertAccessAllowed({ allow: false, reason: "unauthenticated" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toBeInstanceOf(AccessDeniedError);
    expect((thrown as AccessDeniedError).reason).toBe("unauthenticated");
    // No `digest` — that is how Next recognises its own redirect and
    // not-found sentinels, and this must not be mistaken for either.
    expect((thrown as { digest?: unknown }).digest).toBeUndefined();
  });

  it("keeps the middleware's vocabulary for why", () => {
    for (const reason of ["not-configured", "unauthenticated"] as const) {
      try {
        assertAccessAllowed({ allow: false, reason });
        expect.unreachable(`${reason} should have thrown`);
      } catch (error) {
        expect((error as AccessDeniedError).reason).toBe(reason);
      }
    }
  });
});

describe("the decision an action is gated on", () => {
  // `requireAccess` is `assertAccessAllowed(await decideAccess({...}))` with
  // the three inputs read from the cookie jar and the environment. These
  // compose the same two halves to show what an action does in each case.
  const gate = async (options: {
    env: Record<string, string | undefined>;
    token: string | undefined;
    password: string | null;
  }): Promise<void> =>
    assertAccessAllowed(
      await decideAccess({
        trustLocal: localRequestsTrusted(options.env),
        token: options.token,
        password: options.password,
      }),
    );

  it("refuses an action posted with no cookie", async () => {
    // The proven attack: an action ID POSTed to /login, no session anywhere.
    await expect(
      gate({ env: {}, token: undefined, password: "a password" }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("refuses an action when a forged local Host is the only thing on offer", async () => {
    // A header cannot reach the decision, so a request claiming to be
    // localhost gets exactly what any other request gets: refused.
    await expect(
      gate({
        env: { HOST: "localhost", "x-forwarded-host": "127.0.0.1" },
        token: undefined,
        password: "a password",
      }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("refuses everything when nothing is configured and nothing is trusted", async () => {
    await expect(
      gate({ env: {}, token: undefined, password: null }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("runs the action on a machine the operator explicitly trusted", async () => {
    // Local development: TRUST_LOCAL_REQUESTS=1, no password, actions work.
    await expect(
      gate({
        env: { [TRUST_LOCAL_REQUESTS_ENV]: "1" },
        token: undefined,
        password: null,
      }),
    ).resolves.toBeUndefined();
  });
});
