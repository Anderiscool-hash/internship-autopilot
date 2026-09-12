/**
 * The company registry (spec §4).
 *
 * This is the supply side of the whole product: the scanner only ever finds
 * internships at companies listed here, so adding one is the single most
 * effective thing anyone can do in this app. Until now the only way to add a
 * company was to edit prisma/seed.ts and re-run it.
 *
 * Every add is checked against the live board first. A wrong identifier does
 * not error — these platforms return an empty list for a board that does not
 * exist, and a slug belonging to another company returns *their* jobs under
 * the name you typed. So the screen shows what actually came back before
 * anything is saved.
 */

import { AtsType } from "@prisma/client";
import { db } from "@/lib/db";
import { formatAge, formatEnum } from "../jobs/format";
import {
  addCompanyAction,
  recheckCompanyAction,
  setPriorityAction,
  toggleCompanyAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Companies — Internship Autopilot" };

/** The platforms with a working client; the rest cannot be scanned yet. */
const SUPPORTED: AtsType[] = [AtsType.GREENHOUSE, AtsType.LEVER, AtsType.ASHBY];

interface CompaniesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const error = one(params, "error");
  const now = new Date();

  const companies = await db.company.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });

  const scanning = companies.filter((company) => company.active).length;
  const failing = companies.filter((company) => company.failureCount > 0).length;

  return (
    <main className="page page-wide">
      <h1>Companies</h1>
      <p className="lede">
        The boards the scanner watches. {scanning} of {companies.length} are being
        scanned{failing > 0 ? `, ${failing} currently failing` : ""}.
      </p>

      {saved ? <div className="notice notice-ok">{saved}</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <details className="filters-panel" open={companies.length === 0}>
        <summary>Add a company</summary>
        <form className="filters" action={addCompanyAction}>
          <label className="filter">
            <span>Name</span>
            <input type="text" name="name" placeholder="Datadog" required />
          </label>

          <label className="filter">
            <span>ATS</span>
            <select name="atsType" defaultValue={AtsType.GREENHOUSE}>
              {SUPPORTED.map((ats) => (
                <option key={ats} value={ats}>
                  {formatEnum(ats)}
                </option>
              ))}
            </select>
          </label>

          <label className="filter">
            <span>Board identifier</span>
            <input type="text" name="identifier" placeholder="datadog" required />
          </label>

          <div className="filter-actions">
            <button type="submit">Verify and add</button>
          </div>
        </form>
        <p className="note" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
          The identifier is the company&rsquo;s slug on that platform — the part
          after the host in <code>job-boards.greenhouse.io/<strong>datadog</strong></code>{" "}
          or <code>jobs.lever.co/<strong>palantir</strong></code>. Nothing is saved
          until the board answers with real postings, and the confirmation names
          one of them so you can tell it is the right company.
        </p>
      </details>

      <div className="table-wrap">
        {/* Not table.jobs: that class is fixed-layout tuned for the jobs
            table's own seven columns via .col-role etc. Reused here it left
            eight columns — including the priority input+button and the two
            action buttons — splitting one undifferentiated 66% evenly, which
            overlapped text at anything under desktop width (spec: this table
            instead gets its own auto layout below). */}
        <table className="companies-table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">ATS</th>
              <th scope="col">Board</th>
              <th scope="col">Jobs</th>
              <th scope="col">Every</th>
              <th scope="col">Priority</th>
              <th scope="col">Last scan</th>
              <th scope="col">State</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}>
                <td>{company.name}</td>
                <td>{company.atsType ? formatEnum(company.atsType) : "—"}</td>
                <td>
                  <code>{company.atsIdentifier ?? "—"}</code>
                </td>
                <td className="tabular">{company._count.jobs.toLocaleString()}</td>
                <td className="tabular">{company.pollInterval}m</td>
                <td>
                  {/* Inline so changing a priority is one action, not a trip
                      to another screen. */}
                  <form action={setPriorityAction} className="inline-form">
                    <input type="hidden" name="id" value={company.id} />
                    <input
                      type="number"
                      name="scanPriority"
                      min={1}
                      max={99}
                      defaultValue={company.scanPriority}
                      aria-label={`Scan priority for ${company.name}`}
                    />
                    <button type="submit" className="small-button">
                      Set
                    </button>
                  </form>
                </td>
                <td title={company.lastScan?.toISOString() ?? "never scanned"}>
                  {company.lastScan ? formatAge(company.lastScan, now) : "never"}
                </td>
                <td>
                  {company.failureCount > 0 ? (
                    <span
                      className="badge badge-reject"
                      title={`${company.failureCount} consecutive failed scans`}
                    >
                      failing
                    </span>
                  ) : company.active ? (
                    <span className="badge badge-keep">scanning</span>
                  ) : (
                    <span className="badge badge-closed">paused</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <form action={toggleCompanyAction}>
                      <input type="hidden" name="id" value={company.id} />
                      <button type="submit" className="small-button">
                        {company.active ? "Pause" : "Resume"}
                      </button>
                    </form>
                    {company.atsIdentifier ? (
                      <form action={recheckCompanyAction}>
                        <input type="hidden" name="id" value={company.id} />
                        <button type="submit" className="small-button">
                          Re-check
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h2>How often each board is scanned</h2>
        <p className="note">
          The interval is chosen from the board&rsquo;s own activity (spec §5):
          boards that changed in the last day are checked every 12 minutes,
          within the week every 30, otherwise hourly. A company whose priority
          is 10 or lower overrides that and is checked every 5 minutes — that is
          what the priority number is for. Repeated failures back off
          exponentially to a six-hour ceiling rather than being abandoned, and
          resuming a paused company clears its failure count.
        </p>
      </section>
    </main>
  );
}
