/**
 * The lock on the actions, as opposed to the lock on the doors.
 *
 * The middleware is a route guard, and server actions are not routes. Next
 * dispatches a server action by its action ID in the `Next-Action` header, to
 * whatever URL the form happens to post to — so an action reachable only from
 * /profile can be invoked by POSTing its ID to /login, which the middleware
 * matcher deliberately lets past so people can log in. That was not theory
 * here: a POST to /login carrying a profile action's ID ran that action's body
 * with no cookie and no middleware anywhere in the path.
 *
 * So every server action calls `requireAccess()` as its first line and the
 * middleware becomes defence in depth rather than the boundary. This function
 * throws rather than returning a verdict on purpose: a boolean is something a
 * caller can forget to read, and the failure mode of forgetting must not be an
 * action that runs anyway.
 */

import { cookies } from "next/headers";
import {
  configuredPassword,
  decideAccess,
  localRequestsTrusted,
  readSessionToken,
  type AccessDecision,
} from "./session";

/**
 * Thrown when an action is invoked by someone who has not logged in.
 *
 * A real Error, not a redirect and not a returned error object: Next turns an
 * action that rejects into a server error, which is exactly what should happen
 * — the action body never runs and the caller gets nothing back that could be
 * mistaken for a result. A redirect here would be friendlier and wronger,
 * since a redirect is a successful response and some callers treat it as one.
 */
export class AccessDeniedError extends Error {
  /** Same vocabulary the middleware uses, so logs line up. */
  readonly reason: "not-configured" | "unauthenticated";

  constructor(reason: "not-configured" | "unauthenticated") {
    super(
      reason === "not-configured"
        ? "Refused: this app has no APP_PASSWORD set and local requests are not trusted, so it will not act on anything."
        : "Refused: this action needs a valid session.",
    );
    this.name = "AccessDeniedError";
    this.reason = reason;
  }
}

/**
 * Turn a decision into either a return or a throw.
 *
 * Split out from `requireAccess` so the part that can be wrong is a pure
 * function of its input: `requireAccess` itself is only the three reads it
 * needs (cookie, password, flag), and those reads have no branches to get
 * wrong. Nothing here is mocked in the tests because there is nothing left to
 * mock.
 */
export function assertAccessAllowed(decision: AccessDecision): void {
  if (decision.allow) return;
  throw new AccessDeniedError(decision.reason);
}

/**
 * Gate a server action. Call it first, before reading `form`, before touching
 * the database, before anything.
 *
 *     export async function deleteFactAction(form: FormData): Promise<void> {
 *       await requireAccess();
 *       ...
 *     }
 *
 * Returns nothing on success and throws `AccessDeniedError` otherwise, so
 * there is no return value to ignore.
 */
export async function requireAccess(): Promise<void> {
  const store = await cookies();

  assertAccessAllowed(
    await decideAccess({
      // The environment, never the request. See `localRequestsTrusted`.
      trustLocal: localRequestsTrusted(),
      // Checks both cookie names: hardened (`__Host-`) over https, plain over
      // http on localhost. See `readSessionToken`.
      token: readSessionToken((name) => store.get(name)?.value),
      password: configuredPassword(),
    }),
  );
}
