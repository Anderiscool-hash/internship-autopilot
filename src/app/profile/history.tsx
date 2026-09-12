/**
 * Work history and education.
 *
 * These two blocks are required on most application forms and, until now,
 * unanswerable: the tables existed and nothing wrote to them. A live run left
 * "Company name", "Title", "Current role" and "Discipline" empty for exactly
 * that reason.
 *
 * Dates are month inputs, because that is what application forms ask for. A
 * day field would be asking the person to invent one.
 */

import {
  addEducationAction,
  addWorkAction,
  deleteEducationAction,
  deleteWorkAction,
} from "./history-actions";
import type { EducationRow, WorkRow } from "@/lib/candidate/history";

/** "September 2027", or a dash when there is no date. */
function monthLabel(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function WorkHistory({ work }: { work: WorkRow[] }) {
  return (
    <section className="import-panel">
      <h2>Work history</h2>
      <p className="note">
        Forms ask for &ldquo;Company name&rdquo;, &ldquo;Title&rdquo; and &ldquo;Current
        role&rdquo; and mean your current or most recent job. With nothing here, those
        fields are left for you on every application.
      </p>

      {work.length === 0 ? (
        <p className="empty">No jobs on file.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Title</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {work.map((job) => (
                <tr key={job.id}>
                  <td>{job.company}</td>
                  <td>{job.title}</td>
                  <td>{monthLabel(job.startDate)}</td>
                  <td>{job.isCurrent ? "Present" : monthLabel(job.endDate)}</td>
                  <td>
                    <form action={deleteWorkAction}>
                      <input type="hidden" name="id" value={job.id} />
                      <button type="submit" className="link-button">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={addWorkAction} className="import-form">
        <label className="field">
          <span>Company</span>
          <input type="text" name="company" required />
        </label>
        <label className="field">
          <span>Title</span>
          <input type="text" name="title" required />
        </label>
        <label className="field">
          <span>Location</span>
          <input type="text" name="location" placeholder="Brooklyn, NY" />
        </label>
        <label className="field">
          <span>Start</span>
          <input type="month" name="startDate" required />
        </label>
        <label className="field">
          <span>End</span>
          <input type="month" name="endDate" />
          <small>Leave empty and tick below if this is your current job.</small>
        </label>
        <label className="field field-check">
          <input type="checkbox" name="isCurrent" />
          <span>I work here now</span>
        </label>
        <button type="submit" className="small-button">
          Add job
        </button>
      </form>
    </section>
  );
}

export function EducationHistory({ education }: { education: EducationRow[] }) {
  return (
    <section className="import-panel">
      <h2>Education</h2>
      <p className="note">
        Your degree and your discipline are two different questions —
        &ldquo;Bachelor&rsquo;s Degree&rdquo; and &ldquo;Computer Science&rdquo; — and a form
        asks both. Only an entry here can answer the second.
      </p>

      {education.length === 0 ? (
        <p className="empty">No education on file.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">School</th>
                <th scope="col">Degree</th>
                <th scope="col">Discipline</th>
                <th scope="col">Graduates</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {education.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.school}</td>
                  <td>{entry.degree}</td>
                  <td>{entry.fieldOfStudy ?? "—"}</td>
                  <td>{monthLabel(entry.graduationDate ?? entry.endDate)}</td>
                  <td>
                    <form action={deleteEducationAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      <button type="submit" className="link-button">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={addEducationAction} className="import-form">
        <label className="field">
          <span>School</span>
          <input type="text" name="school" required />
        </label>
        <label className="field">
          <span>Degree</span>
          <input type="text" name="degree" placeholder="Bachelor's Degree" required />
        </label>
        <label className="field">
          <span>Discipline</span>
          <input type="text" name="fieldOfStudy" placeholder="Computer Science" />
          <small>What you study, as distinct from the degree you get.</small>
        </label>
        <label className="field">
          <span>Start</span>
          <input type="month" name="startDate" />
        </label>
        <label className="field">
          <span>Graduation (actual or expected)</span>
          <input type="month" name="graduationDate" />
        </label>
        <label className="field">
          <span>GPA</span>
          <input type="text" name="gpa" inputMode="decimal" placeholder="3.7" />
        </label>
        <button type="submit" className="small-button">
          Add education
        </button>
      </form>
    </section>
  );
}
