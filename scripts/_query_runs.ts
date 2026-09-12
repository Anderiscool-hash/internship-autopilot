import { db } from "../src/lib/db";

async function main(): Promise<void> {
  const total = await db.shadowRun.count();
  console.log(`TOTAL ShadowRun rows: ${total}`);

  const runs = await db.shadowRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { job: { include: { company: { select: { name: true } } } } },
  });

  let anyVerificationField = false;
  for (const run of runs) {
    const outcomes = run.outcomes as Array<Record<string, unknown>>;
    for (const o of outcomes) {
      const label = String(o.label ?? "");
      // Broad scan: anything mentioning email, verify, code, otp, pin, confirm
      if (/email|verif|code|otp|\bpin\b|confirm/i.test(label)) {
        anyVerificationField = true;
        console.log(
          `[${run.id}] ${run.job?.company?.name} / ${run.job?.title}: ${JSON.stringify(o)}`,
        );
      }
    }
  }
  if (!anyVerificationField) {
    console.log("No field across ANY run mentioned email/verify/code/otp/pin/confirm.");
  }
  console.log("\n\n--- Detailed view of most recent 8 ---\n");

  for (const run of runs.slice(0, 8)) {
    console.log("=".repeat(80));
    console.log(`Run ${run.id}  createdAt=${run.createdAt.toISOString()}`);
    console.log(`Job: ${run.job?.title ?? "?"} @ ${run.job?.company?.name ?? "?"}`);
    console.log(`atsType=${run.atsType} url=${run.url}`);
    console.log(
      `fieldsTotal=${run.fieldsTotal} filled=${run.fieldsFilled} skipped=${run.fieldsSkipped} failed=${run.fieldsFailed}`,
    );
    console.log(`blockingGaps=${JSON.stringify(run.blockingGaps)}`);
    console.log(`captcha=${run.captcha} loginRequired=${run.loginRequired}`);
    const outcomes = run.outcomes as Array<Record<string, unknown>>;
    const verificationLike = outcomes.filter((o) => {
      const label = String(o.label ?? "").toLowerCase();
      return (
        label.includes("code") ||
        label.includes("verif") ||
        label.includes("otp") ||
        label.includes("pin") ||
        label.includes("confirm")
      );
    });
    if (verificationLike.length > 0) {
      console.log("Verification-like field outcomes:");
      for (const v of verificationLike) console.log("  " + JSON.stringify(v));
    } else {
      console.log("No verification-like field outcomes found in this run's outcomes.");
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => db.$disconnect());
