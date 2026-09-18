/**
 * One job, in full — and whether the candidate can actually take it.
 *
 * The dashboard lists postings; this page is where a posting is judged. It
 * runs the deterministic requirement extraction (spec §10) over the
 * description and renders the hard eligibility table from spec §11.
 *
 * The description itself is rendered as plain text, never as HTML. It is
 * third-party markup fetched from an ATS API, and pasting it into the page
 * would be handing whoever wrote the job ad script execution in this app.
 */

import { notFound } from "next/navigation";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { classifyStudentRole } from "@/lib/jobs/classify";
import { checkEligibility } from "@/lib/eligibility/engine";
import { extractRequirements, toPlainText } from "@/lib/eligibility/extract";
import { readStoredRequirements } from "@/lib/eligibility/stored";
import { formatAge, formatEnum, formatLocation, formatSalary } from "../format";
import { toEligibilityProfile, toFitProfile } from "@/lib/fit/profile";
import { scoreFit } from "@/lib/fit/score";
import { findApplicationForJob } from "@/lib/applications/store";
import { formatEnum as formatStatus } from "../format";
import { headers } from "next/headers";
import { isLocalHost } from "@/lib/auth/session";
import { ShadowButton } from "./shadow-button";
import { TrackControls } from "./track-controls";
import { EligibilityTable } from "./eligibility-table";
import { FitBreakdown } from "./fit-breakdown";

export const dynamic = "force-dynamic";

interface JobPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const JOB_ERRORS: Record<string, string> = {
  "local-only":
    "Shadow mode opens a browser on the machine running this app, so it can only be started from that machine.",
  "profile-required":
    "Fill in your profile first — there would be nothing verified to put in the form.",
};

const JOB_NOTICES: Record<string, string> = {
  "shadow-started":
    "Opening the application form in a browser window. It will fill itself, then hand over to you.",
};

export default async function JobDetailPage({ params, searchParams }: JobPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const message = typeof query.error === "string" ? JOB_ERRORS[query.error] ?? null : null;
  const notice = typeof query.saved === "string" ? JOB_NOTICES[query.saved] ?? null : null;
  const local = isLocalHost((await headers()).get("host"));

  const job = await db.job.findUnique({
    where: { id },
    include: { company: { select: { name: true } } },
  });
  if (!job) notFound();

  const profile = await getProfile(db);
  const now = new Date();

  // Prefer what the scanner extracted at ingest; fall back to extracting now
  // for a posting stored before that column existed and not yet backfilled.
  // Both paths run the same extractor, so the answer is identical either way —
  // this only decides whether the work happens now or happened earlier.
  const requirements =
    readStoredRequirements(job.requirements) ?? extractRequirements(job.description);
  const eligibility = profile
    ? checkEligibility(toEligibilityProfile(profile), requirements)
    : null;

  const tracked = profile ? await findApplicationForJob(db, profile.id, job.id) : null;
  // Same requirements the eligibility table above is built from, so the
  // badge and the table can never disagree about what the posting demands.
  const classification = classifyStudentRole(job.title, requirements);
  const description = toPlainText(job.description);

  // Spec §12 is explicit that only eligible jobs are scored: a fit percentage
  // on a job the candidate cannot legally take is a number that can only
  // mislead. "unconfirmed" still gets scored — nothing has ruled it out.
  const scoreable = profile !== null && eligibility?.verdict !== "ineligible";
  const fit = scoreable
    ? scoreFit(
        toFitProfile(profile),
        {
          title: job.title,
          location: job.location,
          remoteType: job.remoteType,
          description,
          firstSeenAt: job.firstSeenAt,
          requirements,
        },
        now,
      )
    : null;

  // Three different situations reach the fit panel without a number, and the
  // reader can only act on the difference between them.
  const noFitReason =
    profile === null
      ? "No fit score yet — fill in your profile and this becomes a real number."
      : fit === null
        ? "Not scored: this job fails a hard requirement above, and only jobs you are eligible for get scored."
        : "";

  return (
    <main className="page">
      <p className="crumb">
        <a href="/jobs">← All jobs</a>
      </p>

      <h1>{job.title}</h1>
      <p className="lede">
        {job.company.name} · {formatLocation(job.location)} ·{" "}
        {formatEnum(job.remoteType)}
      </p>

      {job.status !== JobStatus.OPEN ? (
        <div className="notice">
          This posting is no longer listed on {job.company.name}&rsquo;s board — the
          scanner marked it {job.status.toLowerCase()}.
        </div>
      ) : null}

      <dl className="facts">
        <div>
          <dt>Pay</dt>
          <dd>{formatSalary(job.salaryMin, job.salaryMax, job.currency)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{formatEnum(job.atsType)}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd title={job.firstSeenAt.toISOString()}>{formatAge(job.firstSeenAt, now)}</dd>
        </div>
        <div>
          <dt>Last seen listed</dt>
          <dd title={job.lastSeenAt.toISOString()}>{formatAge(job.lastSeenAt, now)}</dd>
        </div>
        <div>
          <dt>Title classifier</dt>
          <dd title={classification.reason}>
            <span className={`badge badge-${classification.verdict}`}>
              {classification.verdict}
            </span>
          </dd>
        </div>
      </dl>

      <p>
        <a
          className="apply-link"
          href={job.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the real posting ↗
        </a>
      </p>

      <EligibilityTable
        eligibility={eligibility}
        requirements={requirements}
        hasProfile={profile !== null}
      />

      {message ? <div className="notice notice-error">{message}</div> : null}
      {notice ? <div className="notice notice-ok">{notice}</div> : null}

      <ShadowButton jobId={job.id} local={local} hasProfile={profile !== null} />

      <TrackControls
        jobId={job.id}
        fitScore={fit?.score ?? null}
        trackedStatus={tracked ? formatStatus(tracked.status) : null}
        hasProfile={profile !== null}
      />

      <FitBreakdown fit={fit} reason={noFitReason} />

      <section>
        <h2>Description</h2>
        {/* Plain text on purpose — see the note at the top of this file. */}
        <p className="description">{description}</p>
      </section>
    </main>
  );
}
