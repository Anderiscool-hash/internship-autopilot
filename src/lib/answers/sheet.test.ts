/**
 * Tests for the answer sheet.
 *
 * The parser gets the hardest workout here, on purpose. Everything else in
 * this module produces a file a person reads and can sanity-check with their
 * eyes; the parser is the half that takes what a person typed and turns it
 * into a database write, and a parser that quietly mis-reads an answer would
 * store a wrong fact about the candidate under a question an employer asked.
 * So: an answer containing colons, an answer spanning several lines, a blank
 * answer, a missing REUSE line, an id nothing recognises, and the same id
 * twice.
 */

import { describe, expect, it } from "vitest";
import { worthStoring } from "../apply/ask-plan";
import {
  buildSheet,
  isLegalQuestion,
  noReuseReason,
  optionsFromDetail,
  parseSheet,
  planImport,
  questionId,
  renderSheet,
  summarize,
  type SheetRun,
} from "./sheet";

/** The real rule, so these tests exercise what the script actually runs. */
const storing = worthStoring;

/** A run with one unfilled field, kept short so the interesting bit is visible. */
function run(
  companyName: string,
  label: string,
  detail: string,
  options: { blocking?: boolean; status?: string; atsType?: string } = {},
): SheetRun {
  return {
    companyName,
    atsType: options.atsType ?? "GREENHOUSE",
    blockingGaps: options.blocking ? [label] : [],
    outcomes: [{ label, status: options.status ?? "skipped", detail }],
  };
}

describe("questionId", () => {
  it("is stable for the same text and different for different text", () => {
    expect(questionId("Are you at least 18 years of age?")).toBe(
      questionId("Are you at least 18 years of age?"),
    );
    expect(questionId("Are you at least 18 years of age?")).not.toBe(
      questionId("Are you at least 18 years of age"),
    );
  });

  it("is 16 hex characters, so it is recognisable in the file", () => {
    expect(questionId("Gender")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives every distinct question in a large batch a distinct id", () => {
    // A collision would silently file one question's answer under another's,
    // which is the one failure the id exists to prevent.
    const ids = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) ids.add(questionId(`Question number ${i}?`));
    expect(ids.size).toBe(5_000);
  });
});

describe("optionsFromDetail", () => {
  it("reads a complete list", () => {
    const detail =
      'Dropdown. Your answer ("2029-05") matched none of its 8 options: ' +
      "Anything before Fall/Winter 2026, Fall/Winter 2026, Spring/Summer 2027, " +
      "Fall/Winter 2027, Spring/Summer 2028, Fall/Winter 2028, Spring/Summer 2029, " +
      "Anything AFTER Spring/Summer 2029";
    const parsed = optionsFromDetail(detail);

    expect(parsed.complete).toBe(true);
    expect(parsed.total).toBe(8);
    expect(parsed.options).toHaveLength(8);
    expect(parsed.options[0]).toBe("Anything before Fall/Winter 2026");
  });

  it("marks a sampled list as incomplete and keeps the real total", () => {
    const detail =
      'Dropdown. Your answer ("x") matched none of its 73 options, e.g. ' +
      "Accounting, African Studies, Agriculture, Anthropology, Applied Health Services, Architecture...";
    const parsed = optionsFromDetail(detail);

    expect(parsed.complete).toBe(false);
    expect(parsed.total).toBe(73);
    expect(parsed.options).toEqual([
      "Accounting",
      "African Studies",
      "Agriculture",
      "Anthropology",
      "Applied Health Services",
      "Architecture",
    ]);
  });

  it("reads the older wording that never counted the options", () => {
    const parsed = optionsFromDetail(
      'Dropdown. Your answer ("B.S.") is not one of: Associate\'s Degree, High School, Other',
    );
    expect(parsed.options).toEqual(["Associate's Degree", "High School", "Other"]);
    expect(parsed.complete).toBe(true);
  });

  it("returns nothing when the message recorded no options", () => {
    expect(optionsFromDetail("No stored answer matches this question closely enough.").options)
      .toEqual([]);
    expect(
      optionsFromDetail('This is a dropdown and none of its options match "no". Pick one yourself.')
        .options,
    ).toEqual([]);
  });
});

describe("buildSheet", () => {
  it("puts blocking questions first, then the most-asked", () => {
    const entries = buildSheet(
      [
        run("Acme", "Optional but common", "x"),
        run("Beta", "Optional but common", "x"),
        run("Gamma", "Optional but common", "x"),
        run("Acme", "Required once", "x", { blocking: true }),
      ],
      storing,
    );

    expect(entries.map((entry) => entry.question)).toEqual([
      "Required once",
      "Optional but common",
    ]);
    expect(entries[0]?.blocking).toBe(true);
    expect(entries[1]?.runCount).toBe(3);
  });

  it("ignores fields that were actually filled", () => {
    const entries = buildSheet(
      [
        {
          companyName: "Acme",
          atsType: "GREENHOUSE",
          blockingGaps: [],
          outcomes: [
            { label: "Full name", status: "filled", detail: "Anderson" },
            { label: "Country", status: "chosen", detail: "United States" },
            { label: "Gender", status: "skipped", detail: "No stored answer." },
          ],
        },
      ],
      storing,
    );

    expect(entries.map((entry) => entry.question)).toEqual(["Gender"]);
  });

  it("counts a question once per run even when the form asked it twice", () => {
    const entries = buildSheet(
      [
        {
          companyName: "Acme",
          atsType: "GREENHOUSE",
          blockingGaps: [],
          outcomes: [
            { label: "School", status: "skipped", detail: "a" },
            { label: "School", status: "skipped", detail: "a" },
          ],
        },
      ],
      storing,
    );

    expect(entries[0]?.runCount).toBe(1);
  });

  it("keeps the failure message that names the options over one that names nothing", () => {
    const entries = buildSheet(
      [
        run("Acme", "Degree", "No stored answer matches this question closely enough."),
        run("Beta", "Degree", 'Dropdown. Your answer ("B.S.") is not one of: Bachelor\'s Degree, Other'),
      ],
      storing,
    );

    expect(entries[0]?.options.options).toEqual(["Bachelor's Degree", "Other"]);
    expect(entries[0]?.reason).toContain("is not one of");
  });

  it("defaults the codebase's own no-reuse cases to REUSE: no, with a reason", () => {
    const entries = buildSheet(
      [
        run("Coinbase", "Have you previously been employed by Coinbase in any capacity?", "x"),
        run("Datadog", "Start date month", "x"),
        run("Stripe", "cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]", "x"),
        run("Acme", "Are you at least 18 years of age?", "x"),
      ],
      storing,
    );

    const byQuestion = new Map(entries.map((entry) => [entry.question, entry]));

    expect(byQuestion.get("Have you previously been employed by Coinbase in any capacity?")?.reuse)
      .toBe(false);
    expect(byQuestion.get("Start date month")?.reuse).toBe(false);
    expect(byQuestion.get("cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]")?.reuse).toBe(false);

    // The ordinary reusable case is untouched.
    expect(byQuestion.get("Are you at least 18 years of age?")?.reuse).toBe(true);
    expect(byQuestion.get("Are you at least 18 years of age?")?.noReuseReason).toBeNull();
  });
});

describe("noReuseReason", () => {
  it("objects when ANY of the asking employers is named in the question", () => {
    // Checked against Stripe alone, this question looks perfectly reusable.
    const reason = noReuseReason(
      "Have you previously been employed by Coinbase in any capacity?",
      [
        { companyName: "Stripe", atsType: "GREENHOUSE" },
        { companyName: "Coinbase", atsType: "GREENHOUSE" },
      ],
      storing,
    );
    expect(reason).toContain("Coinbase");
  });
});

describe("renderSheet then parseSheet", () => {
  it("round-trips the ids and the reuse defaults", () => {
    const entries = buildSheet(
      [
        run("Acme", "Are you at least 18 years of age?", "x", { blocking: true }),
        run("Datadog", "Start date month", "x"),
      ],
      storing,
    );
    const parsed = parseSheet(renderSheet(entries, 2));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe(entries[0]?.id);
    expect(parsed[0]?.answer).toBe("");
    expect(parsed.find((block) => block.question === "Start date month")?.reuse).toBe(false);
  });

  it("writes the question verbatim, including the employer's own punctuation", () => {
    const question =
      "To your knowledge, were you referred to this position by a senior leader or decision‑maker?";
    const rendered = renderSheet(buildSheet([run("Coinbase", question, "x")], storing), 1);

    expect(rendered).toContain(`### Q: ${question}`);
  });
});

describe("parseSheet", () => {
  it("keeps an answer containing colons exactly as typed", () => {
    const parsed = parseSheet(
      [
        "### Q: When can you start?",
        "<!-- id: aaaaaaaabbbbbbbb -->",
        "ANSWER: Monday 9:30am: any time after that, really",
        "REUSE: yes",
      ].join("\n"),
    );

    expect(parsed[0]?.answer).toBe("Monday 9:30am: any time after that, really");
  });

  it("keeps a multi-line answer, interior blank lines and all", () => {
    const parsed = parseSheet(
      [
        "### Q: Why are you interested in this role?",
        "<!-- id: 1111111122222222 -->",
        "ANSWER: I have been building a job-tracking program of my own.",
        "",
        "It taught me more about ATS forms than any class did.",
        "REUSE: yes",
      ].join("\n"),
    );

    expect(parsed[0]?.answer).toBe(
      "I have been building a job-tracking program of my own.\n\nIt taught me more about ATS forms than any class did.",
    );
  });

  it("returns a blank answer as blank rather than as something", () => {
    const parsed = parseSheet(
      ["### Q: Gender", "<!-- id: 3333333344444444 -->", "ANSWER:   ", "REUSE: yes"].join("\n"),
    );

    expect(parsed[0]?.answer).toBe("");
  });

  it("reports a missing REUSE line as unknown rather than assuming one", () => {
    const parsed = parseSheet(
      [
        "### Q: Gender",
        "<!-- id: 5555555566666666 -->",
        "ANSWER: Male",
        "",
        "### Q: Next one",
        "<!-- id: 7777777788888888 -->",
        "ANSWER:",
        "REUSE: yes",
      ].join("\n"),
    );

    expect(parsed[0]?.reuse).toBeNull();
    expect(parsed[0]?.answer).toBe("Male");
    expect(parsed[1]?.reuse).toBe(true);
  });

  it("treats an unreadable REUSE value as unknown, not as yes", () => {
    const parsed = parseSheet(
      ["### Q: Gender", "<!-- id: 9999999900000000 -->", "ANSWER: Male", "REUSE: maybe?"].join("\n"),
    );
    expect(parsed[0]?.reuse).toBeNull();
  });

  it("skips a block whose id line was deleted, rather than guessing", () => {
    const parsed = parseSheet(
      ["### Q: Gender", "ANSWER: Male", "REUSE: yes"].join("\n"),
    );
    expect(parsed).toEqual([]);
  });

  it("survives windows line endings", () => {
    const parsed = parseSheet(
      "### Q: Gender\r\n<!-- id: abcdef0123456789 -->\r\nANSWER: Male\r\nREUSE: yes\r\n",
    );
    expect(parsed[0]?.answer).toBe("Male");
    expect(parsed[0]?.reuse).toBe(true);
  });
});

describe("planImport", () => {
  const entries = buildSheet(
    [
      run("Acme", "Are you at least 18 years of age?", "x"),
      run("Acme", "How did you hear about this job?", "x"),
      run("Coinbase", "Have you previously been employed by Coinbase in any capacity?", "x"),
    ],
    storing,
  );
  const idFor = (question: string) => entries.find((entry) => entry.question === question)!.id;

  /** Build the file the person would hand back, with the answers filled in. */
  function filled(answers: Array<[string, string, string?]>): string {
    return answers
      .map(([question, answer, reuse]) =>
        [
          `### Q: ${question}`,
          `<!-- id: ${idFor(question)} -->`,
          `ANSWER: ${answer}`,
          ...(reuse === undefined ? [] : [`REUSE: ${reuse}`]),
          "",
        ].join("\n"),
      )
      .join("\n");
  }

  it("creates a row for a question with nothing stored", () => {
    const decisions = planImport(
      parseSheet(filled([["Are you at least 18 years of age?", "Yes", "yes"]])),
      entries,
      [],
      storing,
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("create");
    expect(decisions[0]?.answer).toBe("Yes");
    expect(decisions[0]?.isLegal).toBe(true);
  });

  it("updates when a different answer is already stored, and reports the old one", () => {
    const decisions = planImport(
      parseSheet(filled([["Are you at least 18 years of age?", "Yes", "yes"]])),
      entries,
      [{ id: "row1", question: "Are you at least 18 years of age?", answer: "No" }],
      storing,
    );

    expect(decisions[0]?.action).toBe("update");
    expect(decisions[0]?.previousAnswer).toBe("No");
    expect(decisions[0]?.existingId).toBe("row1");
  });

  it("calls an identical answer unchanged rather than writing it again", () => {
    const decisions = planImport(
      parseSheet(filled([["Are you at least 18 years of age?", "Yes", "yes"]])),
      entries,
      [{ id: "row1", question: "Are you at least 18 years of age?", answer: "Yes" }],
      storing,
    );

    expect(decisions[0]?.action).toBe("unchanged");
  });

  it("ignores blank answers entirely", () => {
    const decisions = planImport(
      parseSheet(filled([["Are you at least 18 years of age?", "", "yes"]])),
      entries,
      [],
      storing,
    );

    expect(decisions).toEqual([]);
  });

  it("falls back to the sheet's own default when the REUSE line is missing", () => {
    const decisions = planImport(
      parseSheet(filled([["Are you at least 18 years of age?", "Yes"]])),
      entries,
      [],
      storing,
    );

    expect(decisions[0]?.action).toBe("create");
  });

  it("refuses REUSE: no, and says so rather than dropping it", () => {
    const decisions = planImport(
      parseSheet(filled([["How did you hear about this job?", "A friend", "no"]])),
      entries,
      [],
      storing,
    );

    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toContain("REUSE: no");
  });

  it("refuses what worthStoring refuses, naming the employer", () => {
    const decisions = planImport(
      parseSheet(
        filled([
          ["Have you previously been employed by Coinbase in any capacity?", "No", "yes"],
        ]),
      ),
      entries,
      [],
      storing,
    );

    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toContain("Coinbase");
  });

  it("reports an id nothing recognises instead of inventing a question for it", () => {
    const decisions = planImport(
      parseSheet(
        ["### Q: Something I typed myself", "<!-- id: deadbeefdeadbeef -->", "ANSWER: Yes", "REUSE: yes"].join("\n"),
      ),
      entries,
      [],
      storing,
    );

    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toContain("deadbeefdeadbeef");
    expect(decisions[0]?.question).toBe("Something I typed myself");
  });

  it("writes nothing when the same id appears twice with different answers", () => {
    const decisions = planImport(
      parseSheet(
        filled([
          ["Are you at least 18 years of age?", "Yes", "yes"],
          ["Are you at least 18 years of age?", "No", "yes"],
        ]),
      ),
      entries,
      [],
      storing,
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toContain("more than once");
  });

  it("takes the same id twice with the SAME answer as one answer", () => {
    const decisions = planImport(
      parseSheet(
        filled([
          ["Are you at least 18 years of age?", "Yes", "yes"],
          ["Are you at least 18 years of age?", "Yes", "yes"],
        ]),
      ),
      entries,
      [],
      storing,
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("create");
  });

  it("stores the answer byte-for-byte, typos and all", () => {
    const decisions = planImport(
      parseSheet(filled([["How did you hear about this job?", "Career  Page (teh best one)", "yes"]])),
      entries,
      [],
      storing,
    );

    expect(decisions[0]?.answer).toBe("Career  Page (teh best one)");
  });
});

describe("isLegalQuestion", () => {
  it("agrees with run-application's rule on the questions that matter", () => {
    expect(isLegalQuestion("Are you legally authorized to work in the United States?")).toBe(true);
    expect(isLegalQuestion("Will you require sponsorship for employment visa status?")).toBe(true);
    expect(isLegalQuestion("Are you at least 18 years of age?")).toBe(true);
    expect(isLegalQuestion("How did you hear about this job?")).toBe(false);
  });
});

describe("summarize", () => {
  it("counts each decision exactly once", () => {
    const summary = summarize([
      { question: "a", answer: "1", action: "create", reason: null, previousAnswer: null, existingId: null, isLegal: false },
      { question: "b", answer: "2", action: "update", reason: null, previousAnswer: "x", existingId: "r", isLegal: false },
      { question: "c", answer: "3", action: "unchanged", reason: null, previousAnswer: "3", existingId: "r", isLegal: false },
      { question: "d", answer: "4", action: "skip", reason: "no", previousAnswer: null, existingId: null, isLegal: false },
    ]);

    expect(summary).toEqual({ created: 1, updated: 1, unchanged: 1, skipped: 1 });
  });
});
