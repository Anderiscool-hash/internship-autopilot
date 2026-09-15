/**
 * A local stand-in for an employer's application form. TEST ONLY.
 *
 * The submit guard's behaviour is the thing this whole feature has to get
 * right, and it cannot be tested against `file://` pages: the guard compares
 * request hosts (shadow.ts's safeHost), and a form POST needs somewhere real to
 * go. So this serves replica Greenhouse/Lever/Ashby markup on 127.0.0.1 and
 * records every POST it receives.
 *
 * Recording is the point. "The application was submitted" and "the guard
 * stopped it" are only distinguishable if something on the other end can say
 * whether the request arrived.
 *
 * Nothing under src/app may import this module.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedPost {
  path: string;
  body: string;
  contentType: string | null;
}

export interface FixtureServer {
  /** Origin, e.g. http://127.0.0.1:53124 */
  url: string;
  /** Every POST this server received, in order. */
  posts: RecordedPost[];
  close(): Promise<void>;
}

export type FixtureKind = "greenhouse" | "lever" | "ashby" | "slow";

/**
 * The three forms differ only in the markup the adapters key off — the submit
 * button and the success marker. The fields are the same because the filling
 * code is generic and is not what these tests exercise.
 */
const FORMS: Record<FixtureKind, string> = {
  greenhouse: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form id="application_form" method="POST" action="/apply">
    <label for="first_name">First Name <span>*</span></label>
    <input id="first_name" name="job_application[first_name]" type="text" required />
    <label for="email">Email <span>*</span></label>
    <input id="email" name="job_application[email]" type="email" required />
    <input id="submit_app" type="submit" value="Submit application" />
  </form>
</body></html>`,

  lever: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form method="POST" action="/apply" class="application-form">
    <label for="name">First Name<span class="required">*</span></label>
    <input id="name" name="name" type="text" required />
    <label for="email">Email<span class="required">*</span></label>
    <input id="email" name="email" type="email" required />
    <button type="submit" class="template-btn-submit">Submit application</button>
  </form>
</body></html>`,

  ashby: `<!doctype html>
<html><body>
  <h1>Application</h1>
  <form method="POST" action="/apply">
    <label for="_systemfield_name">First Name<span>*</span></label>
    <input id="_systemfield_name" name="_systemfield_name" type="text" required />
    <label for="_systemfield_email">Email<span>*</span></label>
    <input id="_systemfield_email" name="_systemfield_email" type="email" required />
    <button type="submit">Submit application</button>
  </form>
</body></html>`,

  // Never responds to the POST. For proving the window closes on its deadline
  // rather than hanging forever.
  slow: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form method="POST" action="/slow">
    <label for="first_name">First Name<span>*</span></label>
    <input id="first_name" name="first_name" type="text" required />
    <input id="submit_app" type="submit" value="Submit application" />
  </form>
</body></html>`,
};

const SUCCESS_PAGE = `<!doctype html>
<html><body>
  <h1>Application submitted</h1>
  <p>Thank you for applying. We have received your application.</p>
</body></html>`;

const ERROR_PAGE = `<!doctype html>
<html><body>
  <h1>Application</h1>
  <div role="alert" class="error">This field is required.</div>
  <form method="POST" action="/apply">
    <button type="submit">Submit application</button>
  </form>
</body></html>`;

/**
 * Start a fixture on an ephemeral port.
 *
 * Port 0 rather than a fixed one so tests can run in parallel without
 * colliding, and so a leaked server from a previous run cannot be mistaken for
 * this one.
 */
export async function startFixtureServer(kind: FixtureKind): Promise<FixtureServer> {
  const posts: RecordedPost[] = [];

  const server: Server = createServer((request, response) => {
    // `?? "/"` twice: once for a missing url, once because
    // noUncheckedIndexedAccess types `split(...)[0]` as possibly undefined.
    const path = (request.url ?? "/").split("?")[0] ?? "/";

    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        posts.push({
          path,
          body: Buffer.concat(chunks).toString("utf8"),
          contentType: request.headers["content-type"] ?? null,
        });

        // The slow fixture deliberately never answers, so a test can prove the
        // submit window closes on its own deadline.
        if (kind === "slow") return;

        // 303 so the browser follows with a GET, which is what a real ATS does
        // and what detectSubmitted has to cope with.
        response.writeHead(303, { Location: "/submitted" });
        response.end();
      });
      return;
    }

    if (path.startsWith("/submitted")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(SUCCESS_PAGE);
      return;
    }

    if (path.startsWith("/rejected")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(ERROR_PAGE);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(FORMS[kind]);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
