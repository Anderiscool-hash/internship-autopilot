/**
 * URL-backed filters. Native GET submission also works before hydration and
 * keeps browser history and bookmarked searches useful.
 */
import { AtsType, RemoteType } from "@prisma/client";
import { buildJobsHref, DAY_WINDOWS, shortlistActive, type JobFilters } from "@/lib/jobs/filters";
import type { CompanyOption } from "@/lib/jobs/query";
import { formatEnum } from "./format";
import { Icon } from "../ui-icon";
import { appliedJobFilters, clearJobFiltersHref, ELIGIBILITY_LABELS, RELEVANCE_LABELS } from "./filter-presentation";

interface FilterBarProps {
  filters: JobFilters;
  companies: CompanyOption[];
  eligibilityAvailable: boolean;
  hiddenCount: number;
}

export function FilterBar({ filters, companies, eligibilityAvailable, hiddenCount }: FilterBarProps) {
  const shortlisted = shortlistActive(filters);
  const applied = appliedJobFilters(filters, companies);
  const moreCount = [filters.atsType, filters.verdict, filters.eligibility, filters.includeClosed || null].filter(Boolean).length;
  const clearHref = clearJobFiltersHref(filters);
  const selectedCompanyMissing = filters.companyId && !companies.some(company => company.id === filters.companyId);

  return (
    <section className="job-filter-workspace" aria-label="Job filters">
      <div className="job-filter-toolbar">
        <nav className="job-view-switch" aria-label="Listing view">
          <a href={buildJobsHref(filters, { shortlist: true, verdict: null, eligibility: null })} aria-current={shortlisted ? "page" : undefined}>
            <Icon name="check" /> Your shortlist
          </a>
          <a href={buildJobsHref(filters, { shortlist: false })} aria-current={!shortlisted ? "page" : undefined}>All listings</a>
        </nav>
        <nav className="job-filter-shortcuts" aria-label="Quick filters">
          <span>Quick filters</span>
          <a href={buildJobsHref(filters, { remoteType: filters.remoteType === "REMOTE" ? null : "REMOTE" })} aria-current={filters.remoteType === "REMOTE" ? "true" : undefined}>Remote</a>
          <a href={buildJobsHref(filters, { withinDays: filters.withinDays === 7 ? null : 7 })} aria-current={filters.withinDays === 7 ? "true" : undefined}>Past week</a>
        </nav>
      </div>

      <form className="job-filter-form" method="get" action="/jobs" aria-label="Filter job listings">
        <div className="job-filter-main">
          <label className="filter job-filter-title">
            <span>Job title</span>
            <input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="e.g. software engineer" />
          </label>
          <label className="filter">
            <span>Company</span>
            <select name="company" defaultValue={filters.companyId ?? ""}>
              <option value="">All companies</option>
              {selectedCompanyMissing ? <option value={filters.companyId!}>Unavailable company</option> : null}
              {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="filter">
            <span>Work arrangement</span>
            <select name="remote" defaultValue={filters.remoteType ?? ""}>
              <option value="">Any arrangement</option>
              {Object.values(RemoteType).map(value => <option key={value} value={value}>{value === "UNKNOWN" ? "Not specified" : formatEnum(value)}</option>)}
            </select>
          </label>
          <label className="filter">
            <span>Discovered</span>
            <select name="days" defaultValue={filters.withinDays ?? ""}>
              <option value="">Any time</option>
              {DAY_WINDOWS.map(days => <option key={days} value={days}>{days === 1 ? "Past 24 hours" : "Past " + days + " days"}</option>)}
            </select>
          </label>
        </div>

        <details className="job-more-filters" open={moreCount > 0}>
          <summary><Icon name="settings" /> More filters {moreCount > 0 ? <span className="job-filter-count">{moreCount}</span> : null}<span className="job-filter-chevron" aria-hidden="true" /></summary>
          <div className="job-filter-advanced">
            <label className="filter">
              <span>Application platform</span>
              <select name="ats" defaultValue={filters.atsType ?? ""}>
                <option value="">Any platform</option>
                {Object.values(AtsType).map(value => <option key={value} value={value}>{formatEnum(value)}</option>)}
              </select>
            </label>
            <label className="filter">
              <span>Role relevance</span>
              <select name="verdict" defaultValue={filters.verdict ?? ""} aria-describedby="job-relevance-help">
                <option value="">No specific relevance filter</option>
                {Object.entries(RELEVANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="filter">
              <span>Eligibility</span>
              <select name="eligibility" defaultValue={filters.eligibility ?? ""} disabled={!eligibilityAvailable} aria-describedby={eligibilityAvailable ? "job-relevance-help" : "job-eligibility-help"}>
                <option value="">No specific eligibility filter</option>
                {Object.entries(ELIGIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="job-closed-filter">
              <input type="checkbox" name="closed" value="1" defaultChecked={filters.includeClosed} />
              <span>Include closed listings<small>Keep roles that are no longer open in your results.</small></span>
            </label>
            <p className="job-filter-help" id="job-relevance-help">Selecting a specific relevance or eligibility searches all listings, including roles outside your shortlist.</p>
            {!eligibilityAvailable ? <p className="job-filter-help" id="job-eligibility-help"><a href="/profile">Complete your profile</a> to filter by eligibility.</p> : null}
          </div>
        </details>

        {/* An explicit all=1 also keeps the view stable when the last advanced filter is cleared. */}
        {!shortlisted ? <input type="hidden" name="all" value="1" /> : null}
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="dir" value={filters.dir} />
        <div className="job-filter-submit">
          <p>{shortlisted
            ? hiddenCount > 0 ? hiddenCount.toLocaleString() + " non-student or ineligible listings hidden by your shortlist." : "Your shortlist hides non-student and ineligible listings."
            : "All listings are available. Only your selected filters narrow the results."}</p>
          <button type="submit" className="button-primary">Apply filters <Icon name="arrow" /></button>
        </div>
      </form>

      {applied.length > 0 ? (
        <div className="job-applied-filters" aria-label="Applied filters">
          <span className="job-applied-label">{applied.length} active</span>
          {applied.map(item => <a className="job-filter-tag" key={item.key} href={item.href} aria-label={"Remove filter: " + item.label} title={"Remove " + item.label}><span>{item.label}</span><Icon name="close" /></a>)}
          <a className="job-clear-filters" href={clearHref}>Clear filters</a>
        </div>
      ) : null}
    </section>
  );
}
