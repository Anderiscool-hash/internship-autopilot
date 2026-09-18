/**
 * The dashboard's filter bar.
 *
 * A plain HTML form with `method="get"`, which means: no client-side
 * JavaScript, no state management, and the current view is fully described by
 * the URL. Filtered results can be bookmarked and shared, the back button
 * works the way you expect, and the page still functions before (or without)
 * any JS loading.
 *
 * The verdict filter is a hidden field here rather than a control — it is set
 * by the verdict chips above the table, and this keeps it from being wiped
 * every time you press Apply.
 */

import { AtsType, RemoteType } from "@prisma/client";
import { DAY_WINDOWS, type JobFilters } from "@/lib/jobs/filters";
import type { CompanyOption } from "@/lib/jobs/query";
import { formatEnum } from "./format";

interface FilterBarProps {
  filters: JobFilters;
  companies: CompanyOption[];
}

/** How many filters are currently narrowing the list. */
function activeCount(filters: JobFilters): number {
  return [
    filters.q,
    filters.companyId,
    filters.atsType,
    filters.remoteType,
    filters.withinDays,
    filters.includeClosed ? true : null,
  ].filter((value) => value !== null && value !== false).length;
}

export function FilterBar({ filters, companies }: FilterBarProps) {
  const active = activeCount(filters);

  return (
    /* A disclosure rather than a permanent panel. On a phone the open form
       filled the whole first screen, so you scrolled past a screen of controls
       to reach the thing you came for. It opens itself whenever a filter is
       actually on, so an active filter can never be hidden from you. */
    <details className="filters-panel" open={active > 0}>
      <summary>
        Filters
        {active > 0 ? <span className="chip-count">{active} active</span> : null}
      </summary>
      <form className="filters" method="get" action="/jobs">
      <label className="filter">
        <span>Title contains</span>
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="intern, new grad, analyst"
        />
      </label>

      <label className="filter">
        <span>Company</span>
        <select name="company" defaultValue={filters.companyId ?? ""}>
          <option value="">All companies</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name} ({company.jobCount})
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span>ATS</span>
        <select name="ats" defaultValue={filters.atsType ?? ""}>
          <option value="">Any</option>
          {Object.values(AtsType).map((ats) => (
            <option key={ats} value={ats}>
              {formatEnum(ats)}
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span>Remote</span>
        <select name="remote" defaultValue={filters.remoteType ?? ""}>
          <option value="">Any</option>
          {Object.values(RemoteType).map((remote) => (
            <option key={remote} value={remote}>
              {formatEnum(remote)}
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span>First seen</span>
        <select name="days" defaultValue={filters.withinDays ?? ""}>
          <option value="">Any time</option>
          {DAY_WINDOWS.map((days) => (
            <option key={days} value={days}>
              Last {days} {days === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
      </label>

      <label className="filter filter-check">
        <input
          type="checkbox"
          name="closed"
          value="1"
          defaultChecked={filters.includeClosed}
        />
        <span>Include closed</span>
      </label>

      {/* Carries the chip selections through a form submit. */}
      {filters.verdict ? (
        <input type="hidden" name="verdict" value={filters.verdict} />
      ) : null}
      {filters.eligibility ? (
        <input type="hidden" name="eligibility" value={filters.eligibility} />
      ) : null}

      {/* And the same for "show everything". A GET form submits only the
          fields it contains, so without this, pressing Apply would silently
          switch the shortlist back on and make thousands of rows vanish — the
          reader would blame whatever filter they just changed. Only needed
          when no chip is set: a verdict or eligibility field above already
          turns the shortlist off on its own. */}
      {!filters.shortlist && !filters.verdict && !filters.eligibility ? (
        <input type="hidden" name="all" value="1" />
      ) : null}

        <div className="filter-actions">
          <button type="submit">Apply</button>
          <a href="/jobs">Reset</a>
        </div>
      </form>
    </details>
  );
}
