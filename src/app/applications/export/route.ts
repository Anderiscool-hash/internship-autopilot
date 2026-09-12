/**
 * CSV export of the application tracker (spec §24).
 *
 * A plain `<a href>` download rather than a client-side fetch, matching the
 * rest of this app: there is no client-side JavaScript anywhere, so the
 * browser's native "save this response" behavior — driven entirely by the
 * response headers below — is what makes the download work at all.
 */

import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { listApplications } from "@/lib/applications/store";
import { applicationsToCsv, type ApplicationCsvRow } from "@/lib/applications/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getProfile(db);

  // No profile yet means no candidate id to query applications for — export
  // an empty, still-valid CSV (just the header) rather than a 404/500, since
  // "nothing tracked yet" is a real, expected state of this app.
  const applications = profile ? await listApplications(db, profile.id) : [];

  const rows: ApplicationCsvRow[] = applications.map((application) => ({
    companyName: application.job.company.name,
    jobTitle: application.job.title,
    location: application.job.location,
    status: application.status,
    outcome: application.outcome,
    fitScore: application.fitScore,
    postingUrl: application.job.canonicalUrl,
    discoveredAt: application.discoveredAt,
    appliedAt: application.appliedAt,
    confirmedAt: application.confirmedAt,
    notes: application.notes,
  }));

  const csv = applicationsToCsv(rows);
  const filename = `applications-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
