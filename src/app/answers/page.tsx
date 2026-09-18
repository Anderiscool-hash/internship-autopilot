/**
 * The application answer bank (spec §16).
 *
 * Every application form asks the same handful of questions. Answering them
 * once here is what lets an apply run finish instead of stopping halfway to
 * ask — and, per spec §16's closing line, a question with no answer here is
 * exactly what *should* stop it. This screen is how that list gets shorter.
 */

import { db } from "@/lib/db";
import { Questionnaire, type AnswerMap } from "./questionnaire";
import { getProfile } from "@/lib/candidate/store";
import { findAnswer } from "@/lib/answers/match";
import { looksLikeFieldId } from "@/lib/answers/ambiguous-labels";
import { unansweredSuggestions } from "@/lib/apply/ask-plan";
import { QUESTIONNAIRE } from "@/lib/answers/questionnaire";
import { deleteAnswerAction, saveAnswerAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Answers — Internship Autopilot",
};

interface AnswersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const SAVED_MESSAGES: Record<string, string> = {
  answer: "Answer saved.",
  deleted: "Answer removed.",
  questionnaire: "Answers saved.",
};

export default async function AnswersPage({ searchParams }: AnswersPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const error = one(params, "error");
  const note = one(params, "note");

  const profile = await getProfile(db);
  if (!profile) {
    return (
      <main className="page page-wide">
        <h1>Answers</h1>
        <div className="notice">
          Answers belong to a person. <a href="/profile">Fill in your profile</a> first.
        </div>
      </main>
    );
  }

  const entries = await db.answerBankEntry.findMany({
    where: { candidateId: profile.id },
    orderBy: [{ isLegal: "desc" }, { question: "asc" }],
  });

  // What the questionnaire already knows.
  //
  // Exact wording first, then the SAME matcher the autofill uses. Most of these
  // answers were captured by the in-page ask panel, worded however that
  // employer worded the question — so comparing on exact text alone would show
  // an empty sheet to someone who has already answered half of it, and invite
  // them to type it all again.
  const answerMap: AnswerMap = new Map();
  for (const item of QUESTIONNAIRE) {
    const exact = entries.find((entry) => entry.question === item.question);
    if (exact) {
      answerMap.set(item.question, { value: exact.answer });
      continue;
    }
    const match = findAnswer(item.question, entries);
    if (match) {
      answerMap.set(item.question, { value: match.entry.answer, from: match.entry.question });
    }
  }

  // The standard questions that have no answer yet — the actual gap between
  // "this will run" and "this will stop and ask you".
  //
  // The SAME matcher as the sheet above, via `unansweredSuggestions`, and for
  // a reason worth stating: this list used to compare exact lowercase text,
  // which made the page contradict itself. "Are you authorized to work in the
  // US?" is stored under the employer's wording — "Are you legally authorized
  // to work in the United States?" — so the sheet displayed the answer and
  // this list, a few inches below, called the same question unanswered. One
  // matcher means "missing" means what it says: the apply run really will
  // stop here.
  const missing = unansweredSuggestions(entries);

  // Rows whose "question" is really the form's own field id. The form gave no
  // readable label, so the reader fell back to the input's `name` attribute
  // and that machine id became the stored question — which this page then
  // showed to the person as though it were something they had been asked.
  //
  // They are separated out rather than deleted or hidden: the ANSWERS are
  // real ("2029", "September 2026", "Yes"), typed by a person during a real
  // application, and this app does not throw away a candidate's own data or
  // quietly stop showing it. `looksLikeFieldId` is the same predicate the
  // apply path uses to refuse to store new ones, so the two cannot drift.
  const unlabelled = entries.filter((entry) => looksLikeFieldId(entry.question));
  const labelled = entries.filter((entry) => !looksLikeFieldId(entry.question));

  return (
    <main className="page page-wide">
      <h1>Answers</h1>
      <p className="lede">
        The questions every application asks, answered once. An apply run that
        meets a question with no answer here stops and asks you — it never
        invents one.
      </p>

      {note ? <div className="notice">{note}</div> : null}

      {saved && SAVED_MESSAGES[saved] ? (
        <div className="notice notice-ok">{SAVED_MESSAGES[saved]}</div>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <Questionnaire answers={answerMap} />

      <h2>Everything stored</h2>
      <p className="note">
        Including answers captured mid-application by the in-page panel, under whatever
        wording that employer used.
      </p>

      {labelled.length === 0 ? (
        <p className="empty">No answers yet. The sheet above is the quickest way to start.</p>
      ) : (
        <ul className="ledger">
          {labelled.map((entry) => (
            <li key={entry.id}>
              <form className="answer-row" action={saveAnswerAction}>
                <input type="hidden" name="id" value={entry.id} />
                <label className="field field-wide">
                  <span>{entry.question}</span>
                  <input type="hidden" name="question" value={entry.question} />
                  <textarea name="answer" rows={2} defaultValue={entry.answer} />
                </label>
                <label className="field field-check">
                  <input
                    type="checkbox"
                    name="isLegal"
                    defaultChecked={entry.isLegal}
                  />
                  <span>Legal/eligibility answer — never reworded</span>
                </label>
                <button type="submit" className="small-button">
                  Save
                </button>
              </form>
              <form action={deleteAnswerAction}>
                <input type="hidden" name="id" value={entry.id} />
                <button type="submit" className="link-button">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {/* Answers with no question. See the comment on `unlabelled` above for
          how they got here. The point of this section is that the data is
          real and the label is not: show the answer plainly, say why there is
          no question, and give the person the two honest ways out — tell us
          what was asked, or remove the row. No guess at the wording is
          offered, because a guess would be this app inventing a fact about
          the candidate, which is the one thing it must never do. */}
      {unlabelled.length > 0 ? (
        <section>
          <h2>Answers whose question was not readable</h2>
          <div className="notice notice-warn">
            {unlabelled.length === 1
              ? "One answer was saved during an application where the form gave the field no readable label."
              : `${unlabelled.length} answers were saved during an application where the form gave those fields no readable label.`}{" "}
            What is shown below in place of a question is the form&rsquo;s own
            internal name for the box. Your answer is kept exactly as you typed
            it, but it cannot be reused: matching works on the wording of a
            question, and these names are regenerated for every form. Type in
            what the form actually asked to put it back to work, or remove it.
          </div>

          <ul className="ledger">
            {unlabelled.map((entry) => (
              <li key={entry.id}>
                <form className="answer-row" action={saveAnswerAction}>
                  <input type="hidden" name="id" value={entry.id} />
                  <label className="field field-wide">
                    <span>What did the form ask here?</span>
                    <input
                      type="text"
                      name="question"
                      required
                      placeholder="The question, as the form asked it"
                    />
                    <small>
                      The form called this box <code>{entry.question}</code>.
                    </small>
                  </label>
                  <label className="field field-wide">
                    <span>Your answer</span>
                    <textarea name="answer" rows={2} defaultValue={entry.answer} />
                  </label>
                  <label className="field field-check">
                    <input type="checkbox" name="isLegal" defaultChecked={entry.isLegal} />
                    <span>Legal/eligibility answer — never reworded</span>
                  </label>
                  <button type="submit" className="small-button">
                    Save
                  </button>
                </form>
                <form action={deleteAnswerAction}>
                  <input type="hidden" name="id" value={entry.id} />
                  <button type="submit" className="link-button">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {missing.length > 0 ? (
        <section>
          <h2>Still unanswered</h2>
          <p className="note">
            The questions nearly every application asks. Each one left blank is
            a place an apply run will stop — and one already answered in
            different words does not appear here, because that run will not
            stop on it.
          </p>
          {missing.map((suggestion) => (
            <form key={suggestion.question} className="answer-row" action={saveAnswerAction}>
              <input type="hidden" name="question" value={suggestion.question} />
              <label className="field field-wide">
                <span>{suggestion.question}</span>
                <textarea name="answer" rows={2} placeholder="Your answer" />
              </label>
              {suggestion.isLegal ? (
                <input type="hidden" name="isLegal" value="on" />
              ) : null}
              <button type="submit" className="small-button">
                Save answer
              </button>
            </form>
          ))}
        </section>
      ) : null}

      <section>
        <h2>Add your own</h2>
        <form className="answer-row" action={saveAnswerAction}>
          <label className="field field-wide">
            <span>Question, as the form asks it</span>
            <input type="text" name="question" required />
          </label>
          <label className="field field-wide">
            <span>Answer</span>
            <textarea name="answer" rows={3} required />
          </label>
          <label className="field field-check">
            <input type="checkbox" name="isLegal" />
            <span>Legal/eligibility answer — never reworded</span>
          </label>
          <button type="submit" className="small-button">
            Add answer
          </button>
        </form>
      </section>
    </main>
  );
}
