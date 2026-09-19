import { describe, expect, it, vi } from "vitest";
import { ContactEmailStatus, type PrismaClient } from "@prisma/client";
import { upsertContactEmails } from "./store";
import { discoverAddresses, type DiscoverDeps } from "./discover";

describe("contact evidence on rerun", () => {
  it.each([
    [ContactEmailStatus.BOUNCED, 0],
    [ContactEmailStatus.CONFIRMED, 100],
  ])("keeps %s confidence when guesses are saved again", async (status, confidence) => {
    const upsert = vi.fn(async (args: { update: { confidence?: number } }) => ({
      status, confidence: args.update.confidence ?? confidence,
    }));
    const db = { contactEmail: {
      findUnique: vi.fn(async () => ({ status, confidence })),
      upsert,
    } } as unknown as PrismaClient;
    const saved = await upsertContactEmails(db, "c1", [
      { address: " JANE@ACME.COM ", confidence: 12 },
    ]);
    expect(upsert.mock.calls[0]![0].update.confidence).toBeUndefined();
    expect(saved[0]?.confidence).toBe(confidence);
  });

  it("skips a bounced learned address and never re-verifies a confirmed Hunter address", async () => {
    const verify = vi.fn(async () => true);
    const deps: DiscoverDeps = {
      lookupMx: vi.fn(async () => ({ hasMx: true, provider: "other" as const, hosts: ["mx.acme.com"] })),
      hasGravatar: vi.fn(async () => false),
      hunterConfigured: () => true,
      hunterFindEmail: vi.fn(async () => "jane.okafor@acme.com"),
      hunterDomainPattern: vi.fn(async () => null),
      hunterVerify: verify,
      getEmailPattern: vi.fn(async () => "first.last" as const),
      getKnownAddresses: vi.fn(async () => [
        { address: "jane.okafor@acme.com", status: ContactEmailStatus.BOUNCED, confidence: 0 },
      ]),
      saveEmailPattern: vi.fn(async () => undefined),
      saveAddresses: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined),
    };
    const bounced = await discoverAddresses(
      { contactId: "c1", name: { first: "Jane", last: "Okafor" }, domain: "acme.com" }, deps,
    );
    expect(bounced.addresses.every(a => a.address !== "jane.okafor@acme.com")).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    deps.getEmailPattern = async () => null;
    deps.getKnownAddresses = async () => [
      { address: "jane.okafor@acme.com", status: ContactEmailStatus.CONFIRMED, confidence: 100 },
    ];
    await discoverAddresses(
      { contactId: "c1", name: { first: "Jane", last: "Okafor" }, domain: "acme.com" }, deps,
    );
    expect(verify).not.toHaveBeenCalled();
  });
});
