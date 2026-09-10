/**
 * Tests for alert dispatch.
 *
 * These run against a hand-rolled stand-in for Prisma rather than a real
 * database, because the behaviour worth pinning down is the decision-making —
 * who gets alerted, who gets skipped, and what happens when delivery fails —
 * not the SQL.
 *
 * The failure rule is the one that matters: if nothing was delivered, nothing
 * may be recorded as sent, or the alert is lost forever.
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { classifyStudentRole } from "../jobs/classify";
import { ALERT_EVENT, dispatchAlerts } from "./dispatch";
import type { AlertChannel } from "./channels";

interface FakeJob {
  id: string;
  title: string;
  location: string | null;
  canonicalUrl: string;
  firstSeenAt: Date;
  company: { name: string };
}

/** A stand-in for the two Prisma models dispatchAlerts touches. */
function fakeDb(jobs: FakeJob[], alreadyAlerted: string[] = []) {
  const written: { entityId: string; eventType: string }[] = [];

  const db = {
    job: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        jobs.filter((job) => where.id.in.includes(job.id)),
    },
    eventLog: {
      findMany: async ({ where }: { where: { entityId: { in: string[] } } }) =>
        alreadyAlerted
          .filter((id) => where.entityId.in.includes(id))
          .map((entityId) => ({ entityId })),
      createMany: async ({ data }: { data: typeof written }) => {
        written.push(...data);
        return { count: data.length };
      },
    },
  };

  return { db: db as unknown as PrismaClient, written };
}

const NOW = new Date("2026-09-10T12:00:00.000Z");

function job(id: string, title: string): FakeJob {
  return {
    id,
    title,
    location: "NYC",
    canonicalUrl: `https://example.com/${id}`,
    firstSeenAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    company: { name: "Example Corp" },
  };
}

/** A channel that records what it was asked to send. */
function recordingChannel(): AlertChannel & { sent: string[] } {
  const sent: string[] = [];
  const channel = (async (message: string) => {
    sent.push(message);
  }) as AlertChannel & { sent: string[] };
  channel.sent = sent;
  return channel;
}

/** A channel that always fails, like a webhook returning 500. */
const brokenChannel: AlertChannel = async () => {
  throw new Error("webhook responded 500 Internal Server Error");
};

describe("dispatchAlerts", () => {
  it("does nothing when there are no jobs", async () => {
    const { db } = fakeDb([]);
    const channel = recordingChannel();
    const result = await dispatchAlerts(db, [], NOW, [channel]);
    expect(result.alerted).toBe(0);
    expect(channel.sent).toEqual([]);
  });

  it("alerts on student roles and skips the rest", async () => {
    const { db, written } = fakeDb([
      job("a", "Software Engineering Intern"),
      job("b", "Senior Staff Engineer"),
    ]);
    const channel = recordingChannel();

    const result = await dispatchAlerts(db, ["a", "b"], NOW, [channel]);

    expect(result.alerted).toBe(1);
    expect(result.notStudentRole).toBe(1);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toContain("Software Engineering Intern");
    expect(channel.sent[0]).not.toContain("Senior Staff Engineer");
    expect(written).toEqual([
      expect.objectContaining({ entityId: "a", eventType: ALERT_EVENT }),
    ]);
  });

  it("never alerts on the same job twice", async () => {
    const { db, written } = fakeDb([job("a", "Software Engineering Intern")], ["a"]);
    const channel = recordingChannel();

    const result = await dispatchAlerts(db, ["a"], NOW, [channel]);

    expect(result.alerted).toBe(0);
    expect(result.alreadySent).toBe(1);
    expect(channel.sent).toEqual([]);
    expect(written).toEqual([]);
  });

  it("sends one message covering the whole batch", async () => {
    const { db } = fakeDb([
      job("a", "Software Engineering Intern"),
      job("b", "Data Science Intern"),
    ]);
    const channel = recordingChannel();

    await dispatchAlerts(db, ["a", "b"], NOW, [channel]);

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toContain("2 new student-role postings");
  });

  it("does not mark jobs as sent when every channel failed", async () => {
    const { db, written } = fakeDb([job("a", "Software Engineering Intern")]);

    const result = await dispatchAlerts(db, ["a"], NOW, [brokenChannel]);

    expect(result.alerted).toBe(0);
    expect(result.failures).toHaveLength(1);
    // Nothing recorded, so the next cycle will try this job again.
    expect(written).toEqual([]);
  });

  it("marks jobs as sent when at least one channel worked", async () => {
    const { db, written } = fakeDb([job("a", "Software Engineering Intern")]);
    const channel = recordingChannel();

    const result = await dispatchAlerts(db, ["a"], NOW, [brokenChannel, channel]);

    expect(result.alerted).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(written).toHaveLength(1);
  });

  it("alerts on ambiguous titles too, flagged as unconfirmed", async () => {
    // "Analyst Program" is the kind of title the keyword classifier cannot
    // call either way; the alert says so rather than pretending.
    const { db } = fakeDb([job("a", "Analyst Program 2027")]);
    const channel = recordingChannel();

    // Guard the assumption this test rests on.
    expect(classifyStudentRole("Analyst Program 2027").verdict).toBe("ambiguous");

    const result = await dispatchAlerts(db, ["a"], NOW, [channel]);

    expect(result.alerted).toBe(1);
    expect(channel.sent[0]).toContain("unconfirmed");
  });
});
