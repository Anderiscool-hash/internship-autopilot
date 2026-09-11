/**
 * Health check, for whatever ends up hosting this.
 *
 * Every platform wants a URL it can poll to decide whether a container is
 * alive. The useful version of that answers "can this instance actually serve
 * a request", which for this app means the database is reachable — a process
 * that is up but cannot reach Postgres serves errors on every page, and a
 * health check that returns 200 for it is worse than none at all.
 *
 * Deliberately exempt from the password: a load balancer cannot log in. It
 * reveals nothing beyond up/down and a row count.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    // A real query, not a connection check: a pool can hold a handle to a
    // database that has since gone away.
    const jobs = await db.job.count();

    return NextResponse.json({
      status: "ok",
      database: "reachable",
      jobs,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
