/**
 * The connection half of the mailbox reader is not unit-testable without an
 * IMAP server, so what is tested here is the part that decides whether to
 * connect at all — and the defaults that decide how.
 */

import { describe, expect, it } from "vitest";
import { inboxConfig } from "./inbox";

describe("inboxConfig", () => {
  it("is null when nothing is configured", () => {
    // An ordinary state: the feature is opt-in, and a run with no mailbox
    // simply asks the person for the code.
    expect(inboxConfig({})).toBeNull();
  });

  it("is null when the configuration is half-filled", () => {
    expect(inboxConfig({ IMAP_HOST: "imap.gmail.com", IMAP_USER: "a@b.com" })).toBeNull();
    expect(inboxConfig({ IMAP_HOST: "imap.gmail.com", IMAP_PASSWORD: "x" })).toBeNull();
  });

  it("reads a full configuration", () => {
    const config = inboxConfig({
      IMAP_HOST: "imap.gmail.com",
      IMAP_USER: "a@b.com",
      IMAP_PASSWORD: "app-password",
    });

    expect(config).toEqual({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      user: "a@b.com",
      password: "app-password",
    });
  });

  // TLS off has to be asked for in words. A typo in IMAP_TLS must not
  // silently send a mailbox password in the clear.
  it("keeps TLS on unless explicitly disabled", () => {
    const base = { IMAP_HOST: "h", IMAP_USER: "u", IMAP_PASSWORD: "p" };
    expect(inboxConfig({ ...base })?.secure).toBe(true);
    expect(inboxConfig({ ...base, IMAP_TLS: "yes" })?.secure).toBe(true);
    expect(inboxConfig({ ...base, IMAP_TLS: "tru" })?.secure).toBe(true);
    expect(inboxConfig({ ...base, IMAP_TLS: "false" })?.secure).toBe(false);
  });

  it("falls back to 993 when the port is not a number", () => {
    const config = inboxConfig({
      IMAP_HOST: "h",
      IMAP_USER: "u",
      IMAP_PASSWORD: "p",
      IMAP_PORT: "not-a-port",
    });
    expect(config?.port).toBe(993);
  });
});
