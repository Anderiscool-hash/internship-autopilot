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
import { formatAge, formatEnum, formatLocation, formatSalary } from "../format";
import { EligibilityTable } from "./eligibility-table";

export const dynamic = "force-dynamic";

interface JobPageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: JobPageProps) {
  const { id } = await params;

  const job = await db.job.findUnique({
    where: { id },
    include: { company: { select: { name: true } } },
  });
  if (!job) notFound();

  const profile = await getProfile(db);
  const now = new Date();

  const requirements = extractRequirements(job.description);
  const eligibility = profile
    ? checkEligibility(
        {
          degree: profile.degree,
          graduationDate: profile.graduationDate,
          needsSponsorship: profile.needsSponsorship,
          citizenship: profile.citizenship,
          workAuthorization: profile.workAuthorization,
          certifications: profile.certifications,
        },
        requirements,
      )
    : null;

  const classification = classifyStudentRole(job.title);
  const description = toPlainText(job.description);

  return (
    <main className="page page-wide">
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

      <section>
        <h2>Description</h2>
        {/* Plain text on purpose — see the note at the top of this file. */}
        <p className="description">{description}</p>
      </section>
    </main>
  );
}
