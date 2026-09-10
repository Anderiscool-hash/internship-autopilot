/**
 * The Truth Ledger (spec §3).
 *
 * Every claim the resume and cover-letter builders are allowed to make has to
 * come from a row here. That is the whole safety property of this project: the
 * AI does not get to decide what is true about you, it only gets to rephrase
 * what you have written down.
 *
 * So this screen is deliberately blunt — a list of statements and a form to add
 * one. No AI assistance in filling it in, because a ledger the AI helped write
 * would defeat the point of having one.
 */

import { TruthFactCategory } from "@prisma/client";
import type { TruthFact } from "@prisma/client";
import { formatEnum } from "../jobs/format";
import { addFactAction, deleteFactAction } from "./actions";

/** Group facts by category so the ledger reads as sections, not a flat list. */
function byCategory(facts: TruthFact[]): Map<TruthFactCategory, TruthFact[]> {
  const grouped = new Map<TruthFactCategory, TruthFact[]>();
  for (const fact of facts) {
    const existing = grouped.get(fact.category);
    if (existing) existing.push(fact);
    else grouped.set(fact.category, [fact]);
  }
  return grouped;
}

/** The optional structured fields, shown only when they were filled in. */
function factDetails(fact: TruthFact): string[] {
  const details: string[] = [];
  if (fact.company) details.push(fact.company);
  if (fact.role) details.push(fact.role);
  if (fact.technology) details.push(fact.technology);
  if (fact.metric) details.push(fact.metric);
  if (fact.sourceDate) details.push(fact.sourceDate.toISOString().slice(0, 10));
  return details;
}

export function TruthLedger({
  facts,
  canAdd,
}: {
  facts: TruthFact[];
  canAdd: boolean;
}) {
  const grouped = byCategory(facts);

  return (
    <section className="stack">
      <h2>Truth Ledger</h2>
      <p className="note">
        The only source of claims the AI may use about you (spec §3). If it is
        not written here, no resume or cover letter this app generates is allowed
        to say it.
      </p>

      {facts.length === 0 ? (
        <p className="empty">
          The ledger is empty. Nothing can be written on your behalf until it has
          something in it.
        </p>
      ) : (
        [...grouped.entries()].map(([category, categoryFacts]) => (
          <div key={category} className="ledger-group">
            <h3>{formatEnum(category)}</h3>
            <ul className="ledger">
              {categoryFacts.map((fact) => (
                <li key={fact.id}>
                  <div>
                    <p className="statement">{fact.statement}</p>
                    {factDetails(fact).length > 0 ? (
                      <p className="details">{factDetails(fact).join(" · ")}</p>
                    ) : null}
                  </div>
                  <form action={deleteFactAction}>
                    <input type="hidden" name="factId" value={fact.id} />
                    <button type="submit" className="link-button">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <form className="stack" action={addFactAction}>
        <h3>Add a fact</h3>
        {!canAdd ? (
          <p className="note">Save your profile first — facts belong to a candidate.</p>
        ) : null}
        <div className="grid">
          <label className="field">
            <span>Category</span>
            <select name="category" defaultValue={TruthFactCategory.EXPERIENCE}>
              {Object.values(TruthFactCategory).map((category) => (
                <option key={category} value={category}>
                  {formatEnum(category)}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-wide">
            <span>Statement</span>
            <textarea
              name="statement"
              rows={2}
              required
              placeholder="Uniqlo — Seasonal Sales Associate — inventory and restocking"
            />
          </label>
        </div>
        <div className="grid">
          <label className="field">
            <span>Company</span>
            <input type="text" name="company" />
          </label>
          <label className="field">
            <span>Role</span>
            <input type="text" name="role" />
          </label>
          <label className="field">
            <span>Technology</span>
            <input type="text" name="technology" />
          </label>
          <label className="field">
            <span>Metric</span>
            <input type="text" name="metric" placeholder="50 units/day" />
            <small>Only if a real number exists. No number, leave it blank.</small>
          </label>
          <label className="field">
            <span>Date</span>
            <input type="month" name="sourceDate" />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={!canAdd}>
            Add to ledger
          </button>
        </div>
      </form>
    </section>
  );
}
