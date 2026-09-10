/**
 * The application answer bank (spec §16).
 *
 * Every application form asks the same handful of questions. Answering them
 * once here is what lets an apply run finish instead of stopping halfway to
 * ask — and, per spec §16's closing line, a question with no answer here is
 * exactly what *should* stop it. This screen is how that list gets shorter.
 */

import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { SUGGESTED_QUESTIONS } from "@/lib/answers/match";
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
};

export default async function AnswersPage({ searchParams }: AnswersPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const error = one(params, "error");

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

  // The spec's standard questions that have no answer yet — the actual gap
  // between "this will run" and "this will stop and ask you".
  const answered = new Set(entries.map((entry) => entry.question.toLowerCase()));
  const missing = SUGGESTED_QUESTIONS.filter(
    (suggestion) => !answered.has(suggestion.question.toLowerCase()),
  );

  return (
    <main className="page page-wide">
      <h1>Answers</h1>
      <p className="lede">
        The questions every application asks, answered once. An apply run that
        meets a question with no answer here stops and asks you — it never
        invents one (spec §16).
      </p>

      {saved && SAVED_MESSAGES[saved] ? (
        <div className="notice notice-ok">{SAVED_MESSAGES[saved]}</div>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      {entries.length === 0 ? (
        <p className="empty">No answers yet. The suggestions below are a good start.</p>
      ) : (
        <ul className="ledger">
          {entries.map((entry) => (
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

      {missing.length > 0 ? (
        <section>
          <h2>Still unanswered</h2>
          <p className="note">
            These are spec §16&rsquo;s standard questions. Each one left blank is
            a place an apply run will stop.
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
