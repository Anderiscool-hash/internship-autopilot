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

export function FilterBar({ filters, companies }: FilterBarProps) {
  return (
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

      {/* Carries the chip selection through a form submit. */}
      {filters.verdict ? (
        <input type="hidden" name="verdict" value={filters.verdict} />
      ) : null}

      <div className="filter-actions">
        <button type="submit">Apply</button>
        <a href="/jobs">Reset</a>
      </div>
    </form>
  );
}
