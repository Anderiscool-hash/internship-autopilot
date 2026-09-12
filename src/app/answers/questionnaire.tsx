/**
 * The fill-in-the-blank sheet.
 *
 * Answer these once and most of an application form answers itself. The
 * counter at the top is the point of the screen: it turns a vague "am I set
 * up?" into a number.
 *
 * Every field is pre-filled with whatever is already stored, so this is also
 * the place to revise an answer the ask-panel captured mid-application.
 */

import {
  fieldNameFor,
  GROUP_META,
  GROUP_ORDER,
  QUESTIONNAIRE,
  type QuestionnaireItem,
} from "@/lib/answers/questionnaire";
import { saveQuestionnaireAction } from "./questionnaire-actions";

/**
 * What is already known for one questionnaire question.
 *
 * `from` names the stored entry the value came from when it was not stored
 * under this exact wording. A person who answered "Are you authorized to work
 * in the US?" through the in-page ask panel should not be asked the same thing
 * again here just because this file words it differently — and saving must
 * update THAT entry rather than leaving a near-duplicate beside it.
 */
export interface KnownAnswer {
  value: string;
  /** The stored question this came from, when it differs from the canonical one. */
  from?: string;
}

export type AnswerMap = Map<string, KnownAnswer>;

function Field({
  item,
  index,
  known,
}: {
  item: QuestionnaireItem;
  index: number;
  known: KnownAnswer | undefined;
}) {
  const name = fieldNameFor(index);
  const current = known?.value ?? "";
  const answered = current.length > 0;

  return (
    <label className={`field field-wide${answered ? "" : " field-unanswered"}`}>
      <span>
        {item.label ?? item.question}
        {item.isLegal ? <span className="badge badge-legal">legal</span> : null}
      </span>

      {item.input === "long-text" ? (
        <textarea name={name} rows={3} defaultValue={current} />
      ) : item.input === "choice" ? (
        <select name={name} defaultValue={current}>
          {/* The empty option is first and selected by default on purpose:
              nothing here may acquire an answer by the person not looking. */}
          <option value="">— not answered —</option>
          {/* A stored answer the option list does not cover — "yes" against
              "Yes", or something the ask panel captured from an employer's own
              wording. It MUST appear here: without it the select falls back to
              "not answered", and saving the page then deletes a real answer the
              person never touched. That happened. */}
          {current.length > 0 && !(item.options ?? []).includes(current) ? (
            <option value={current}>{current} (as you answered it)</option>
          ) : null}
          {(item.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" name={name} defaultValue={current} />
      )}

      {/* Where this answer already lives, so saving updates it instead of
          leaving a near-duplicate beside it. */}
      {known?.from ? <input type="hidden" name={`${name}__from`} value={known.from} /> : null}

      {/* What the field held when the page was rendered — sent for EVERY
          pre-filled field, not just matched ones. The action uses it to tell
          "the person cleared this" from "this was never answered", and only
          the first of those may delete anything. */}
      {answered ? <input type="hidden" name={`${name}__was`} value={current} /> : null}

      {known?.from ? (
        <small>
          Already answered as &ldquo;{known.from}&rdquo;. Editing this updates that answer.
        </small>
      ) : item.hint ? (
        <small>{item.hint}</small>
      ) : null}
    </label>
  );
}

export function Questionnaire({ answers }: { answers: AnswerMap }) {
  const answeredCount = QUESTIONNAIRE.filter(
    (item) => (answers.get(item.question)?.value ?? "").length > 0,
  ).length;
  const total = QUESTIONNAIRE.length;
  const percent = Math.round((answeredCount / total) * 100);

  return (
    <section className="import-panel">
      <h2>Common questions</h2>
      <p className="note">
        These are the questions employers ask over and over. Fill them in once and an
        application stops asking you — anything left blank stays blank, and the run pauses
        on it rather than guessing.
      </p>

      <p className={answeredCount === total ? "notice notice-ok" : "notice"}>
        <strong>
          {answeredCount} of {total} answered ({percent}%).
        </strong>{" "}
        {answeredCount === total
          ? "Nothing here will stop an application."
          : "Each one you add is one fewer interruption mid-application."}
      </p>

      <form action={saveQuestionnaireAction}>
        {GROUP_ORDER.map((group) => {
          const items = QUESTIONNAIRE.map((item, index) => ({ item, index })).filter(
            ({ item }) => item.group === group,
          );
          if (items.length === 0) return null;

          const meta = GROUP_META[group];
          return (
            <fieldset key={group} className="question-group">
              <legend>{meta.title}</legend>
              <p className="note">{meta.blurb}</p>
              <div className="question-grid">
                {items.map(({ item, index }) => (
                  <Field
                    key={item.question}
                    item={item}
                    index={index}
                    known={answers.get(item.question)}
                  />
                ))}
              </div>
            </fieldset>
          );
        })}

        <button type="submit">Save answers</button>
        <p className="note">
          Emptying a box removes that answer rather than storing a blank one — an
          application should stop and ask you, not type nothing into the field.
        </p>
      </form>
    </section>
  );
}
