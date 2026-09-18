/**
 * The command center.
 *
 * The old root immediately redirected to Jobs, which made every visit start
 * with a table but gave no answer to the more important question: what needs
 * attention right now? This page is deliberately read-only. It assembles the
 * state already recorded by discovery, the tracker, the review queue and the
 * local daemon without creating a second source of truth.
 */

import { ApplicationOutcome, ApplicationStatus, JobStatus } from "@prisma/client";
import { daemonStatus } from "@/lib/apply/daemon-client";
import { db } from "@/lib/db";
import { formatAge, formatEnum, formatLocation } from "./jobs/format";
import { Icon } from "./ui-icon";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Overview - Internship Autopilot",
};

const NEEDS_YOU = new Set<ApplicationStatus>([
  ApplicationStatus.WAITING_FOR_USER,
  ApplicationStatus.CAPTCHA,
  ApplicationStatus.LOGIN_REQUIRED,
  ApplicationStatus.AMBIGUOUS_QUESTION,
  ApplicationStatus.FAILED,
]);

async function loadOverview() {
  const now = new Date();
  const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    profile,
    openJobs,
    newJobs,
    activeCompanies,
    failingCompanies,
    pendingReviews,
    latestScan,
    ai,
    recentJobs,
    daemon,
  ] = await Promise.all([
    db.candidate.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            truthFacts: true,
            answerBankEntries: true,
            documents: true,
          },
        },
      },
    }),
    db.job.count({ where: { status: JobStatus.OPEN } }),
    db.job.count({
      where: { status: JobStatus.OPEN, firstSeenAt: { gte: sinceYesterday } },
    }),
    db.company.count({ where: { active: true } }),
    db.company.count({ where: { active: true, failureCount: { gt: 0 } } }),
    db.shadowRun.count({ where: { verdict: null } }),
    db.company.findFirst({
      where: { lastScan: { not: null } },
      orderBy: { lastScan: "desc" },
      select: { lastScan: true },
    }),
    db.aiSettings.findUnique({
      where: { id: "singleton" },
      select: { provider: true, model: true },
    }),
    db.job.findMany({
      where: { status: JobStatus.OPEN },
      orderBy: { firstSeenAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        location: true,
        remoteType: true,
        firstSeenAt: true,
        company: { select: { name: true } },
      },
    }),
    daemonStatus(),
  ]);

  const applications = profile
    ? await db.application.findMany({
        where: { candidateId: profile.id },
        select: { status: true, appliedAt: true, outcome: true },
      })
    : [];

  return {
    now,
    profile,
    openJobs,
    newJobs,
    activeCompanies,
    failingCompanies,
    pendingReviews,
    lastScan: latestScan?.lastScan ?? null,
    ai,
    daemon,
    recentJobs,
    tracked: applications.length,
    needsYou: applications.filter((item) => NEEDS_YOU.has(item.status)).length,
    applied: applications.filter((item) => item.appliedAt !== null).length,
    interviews: applications.filter(
      (item) =>
        item.outcome === ApplicationOutcome.INTERVIEW ||
        item.outcome === ApplicationOutcome.FINAL_ROUND,
    ).length,
    offers: applications.filter((item) => item.outcome === ApplicationOutcome.OFFER)
      .length,
  };
}

type Overview = Awaited<ReturnType<typeof loadOverview>>;
type Action = { href: string; label: string; detail: string; tone: "warn" | "info" };

export default async function HomePage() {
  let data: Overview;
  try {
    data = await loadOverview();
  } catch {
    return (
      <main className="page page-wide overview-page">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>Your internship command center</h1>
        <div className="notice notice-error overview-failure">
          <strong>The dashboard cannot reach Postgres.</strong>
          <p>
            Start the local database, then reload. No technical error details are
            exposed here; check the server console if Postgres is already running.
          </p>
          <a className="button" href="/">Try again</a>
        </div>
      </main>
    );
  }

  const firstName = data.profile?.name.trim().split(/\s+/)[0] ?? null;
  const actions: Action[] = [];
  if (!data.profile) {
    actions.push({
      href: "/profile",
      label: "Create your candidate profile",
      detail: "Add your experience and preferences to start finding roles that fit.",
      tone: "warn",
    });
  } else {
    if (data.profile._count.truthFacts === 0) {
      actions.push({
        href: "/profile",
        label: "Add verified facts",
        detail: "Add your skills and experience so tailored applications have the right details.",
        tone: "warn",
      });
    }
    if (data.profile._count.answerBankEntries === 0) {
      actions.push({
        href: "/answers",
        label: "Build your answer bank",
        detail: "Save answers to common questions to keep applications moving.",
        tone: "info",
      });
    }
  }
  if (data.pendingReviews > 0) {
    actions.push({
      href: "/shadow-runs",
      label: `${data.pendingReviews} ${data.pendingReviews === 1 ? "run is" : "runs are"} ready for review`,
      detail: "Check the test results and confirm what the application assistant got right.",
      tone: "warn",
    });
  }
  if (data.needsYou > 0) {
    actions.push({
      href: "/applications",
      label: `${data.needsYou} tracked ${data.needsYou === 1 ? "application needs" : "applications need"} you`,
      detail: "Review a filled form, answer a blocker, or resolve a failed run.",
      tone: "warn",
    });
  }
  if (data.failingCompanies > 0) {
    actions.push({
      href: "/companies",
      label: `${data.failingCompanies} company ${data.failingCompanies === 1 ? "board needs" : "boards need"} attention`,
      detail: "Some boards could not be checked. Take a look to keep new roles coming in.",
      tone: "warn",
    });
  }

  return (
    <main className="page page-wide overview-page">
      <section className="overview-hero">
        <div>
          <p className="eyebrow">
            Your workspace <span aria-hidden="true">&middot;</span>{" "}
            <time dateTime={data.now.toISOString()}>{data.now.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</time>
          </p>
          <h1>{firstName ? `Welcome back, ${firstName}.` : "Your internship command center."}</h1>
          <p className="overview-intro">
            Review new opportunities and keep your applications moving.
          </p>
        </div>
        <div className="hero-actions">
          <a className="button" href="/applications">View applications</a>
          <a className="button button-primary" href="/jobs">Find opportunities <Icon name="arrow" /></a>
        </div>
      </section>

      <section className="metric-grid" aria-label="Search summary">
        <MetricCard label="Open listings" value={data.openJobs} detail="across your company boards" href="/jobs?all=1" />
        <MetricCard label="New in 24 hours" value={data.newJobs} detail="recently discovered listings" href="/jobs?all=1&days=1" />
        <MetricCard label="Applications" value={data.tracked} detail={`${data.applied} sent to employers`} href="/applications" />
        <MetricCard label="Needs attention" value={data.needsYou + data.pendingReviews} detail="reviews and next steps" href={data.needsYou > 0 ? "/applications" : "/shadow-runs"} urgent={data.needsYou + data.pendingReviews > 0} />
      </section>

      <div className="overview-grid">
        <section className="overview-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Keep things moving</p>
              <h2>Your next steps</h2>
            </div>
            <span className="panel-count">{actions.length}</span>
          </div>
          {actions.length === 0 ? (
            <div className="clear-state">
              <span className="clear-state-mark" aria-hidden="true">✓</span>
              <div>
                <strong>Nothing is blocked.</strong>
                <p>Your setup is ready and every review queue is clear.</p>
              </div>
            </div>
          ) : (
            <div className="action-list">
              {actions.map((action) => <ActionRow key={action.href + action.label} {...action} />)}
            </div>
          )}
        </section>

        <section className="overview-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Behind the scenes</p>
              <h2>Workspace status</h2>
            </div>
          </div>
          <div className="health-list">
            <HealthRow
              label="Scanner"
              value={data.lastScan ? `Last scan ${formatAge(data.lastScan, data.now)}` : "No completed scan"}
              detail={`${data.activeCompanies} active boards${data.failingCompanies ? `, ${data.failingCompanies} failing` : ""}`}
              href="/companies"
              tone={data.lastScan && data.failingCompanies === 0 ? "good" : "warn"}
            />
            <HealthRow
              label="Applications"
              value={data.daemon ? "Worker online" : "Worker offline"}
              detail={data.daemon ? "Ready to help fill application forms" : "Form filling will be available when the worker starts"}
              href="/applications"
              tone={data.daemon ? "good" : "idle"}
            />
            <HealthRow
              label="AI provider"
              value={data.ai ? formatEnum(data.ai.provider) : "Not configured"}
              detail={data.ai?.model ?? "Rule-based discovery and scoring still work"}
              href="/settings/ai"
              tone={data.ai && data.ai.provider !== "NONE" ? "good" : "idle"}
            />
            <HealthRow
              label="Your profile"
              value={data.profile ? `${data.profile._count.truthFacts} verified facts` : "Profile missing"}
              detail={data.profile ? `${data.profile._count.answerBankEntries} saved answers, ${data.profile._count.documents} documents` : "Add your experience to get started"}
              href="/profile"
              tone={data.profile && data.profile._count.truthFacts > 0 ? "good" : "warn"}
            />
          </div>
        </section>
      </div>

      <section className="overview-panel recent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Across your company boards</p>
            <h2>Latest discoveries</h2>
          </div>
          <a href="/jobs?all=1">All listings <Icon name="arrow" /></a>
        </div>
        {data.recentJobs.length === 0 ? (
          <p className="empty-compact">No open roles yet. Add a verified company board, then run discovery.</p>
        ) : (
          <div className="recent-jobs">
            {data.recentJobs.map((job) => (
              <a className="recent-job" href={`/jobs/${job.id}`} key={job.id}>
                <span className="company-monogram" aria-hidden="true">{job.company.name.slice(0, 2).toUpperCase()}</span>
                <span className="recent-job-main">
                  <strong>{job.title}</strong>
                  <span>{job.company.name} · {formatLocation(job.location)}</span>
                </span>
                <span className="recent-job-meta">
                  {job.remoteType !== "UNKNOWN" ? <span className="badge">{formatEnum(job.remoteType)}</span> : null}
                  <time dateTime={job.firstSeenAt.toISOString()}>{formatAge(job.firstSeenAt, data.now)}</time>
                  <span aria-hidden="true">→</span>
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="pipeline-panel" aria-labelledby="pipeline-title">
        <div>
          <p className="eyebrow">The bigger picture</p>
          <h2 id="pipeline-title">Your progress</h2>
        </div>
        <ol className="pipeline">
          <PipelineStep label="Open" value={data.openJobs} />
          <PipelineStep label="Tracked" value={data.tracked} />
          <PipelineStep label="Applied" value={data.applied} />
          <PipelineStep label="Interviewing" value={data.interviews} />
          <PipelineStep label="Offers" value={data.offers} />
        </ol>
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail, href, urgent = false }: { label: string; value: number; detail: string; href: string; urgent?: boolean }) {
  return (
    <a className={urgent ? "metric-card metric-card-urgent" : "metric-card"} href={href}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value.toLocaleString()}</strong>
      <span className="metric-detail">{detail}</span>
    </a>
  );
}

function ActionRow({ href, label, detail, tone }: Action) {
  return (
    <a className="action-row" href={href}>
      <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />
      <span><strong>{label}</strong><small>{detail}</small></span>
      <span className="action-arrow" aria-hidden="true">→</span>
    </a>
  );
}

function HealthRow({ label, value, detail, href, tone }: { label: string; value: string; detail: string; href: string; tone: "good" | "warn" | "idle" }) {
  return (
    <a className="health-row" href={href}>
      <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />
      <span className="health-name">{label}</span>
      <span className="health-copy"><strong>{value}</strong><small>{detail}</small></span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

function PipelineStep({ label, value }: { label: string; value: number }) {
  return (
    <li>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </li>
  );
}
