/**
 * Tests for answer-bank matching (spec §16).
 *
 * The tests that matter most are the ones asserting a NON-match. Spec §16 says
 * unknown answers must pause automation rather than be invented, so a matcher
 * that stretches to find something is worse than one that gives up: the cost
 * of stopping is a minute of someone's attention, and the cost of a wrong
 * match is a false answer submitted to an employer in their name.
 */

import { describe, it, expect } from "vitest";
import {
  findAnswer,
  MATCH_THRESHOLD,
  normalizeQuestion,
  questionSimilarity,
  SUGGESTED_QUESTIONS,
  type AnswerEntry,
} from "./match";

const ENTRIES: AnswerEntry[] = [
  {
    id: "auth",
    question: "Are you authorized to work in the US?",
    answer: "Yes",
    isLegal: true,
  },
  {
    id: "sponsorship",
    question: "Will you now or in the future require sponsorship?",
    answer: "No",
    isLegal: true,
  },
  {
    id: "why",
    question: "Why are you interested in this role?",
    answer: "Because ...",
    isLegal: false,
  },
];

describe("normalizeQuestion", () => {
  it("drops punctuation, casing and filler words", () => {
    expect(normalizeQuestion("Are you authorized to work in the US?")).toEqual([
      "authorized",
      "work",
      "us",
    ]);
  });

  it("survives the ways different ATS platforms write the same question", () => {
    const a = normalizeQuestion("Are you authorized to work in the US?");
    const b = normalizeQuestion("ARE YOU AUTHORIZED TO WORK IN THE US");
    expect(a).toEqual(b);
  });
});

describe("questionSimilarity", () => {
  it("is 1 for the same question written differently", () => {
    expect(
      questionSimilarity(
        "Are you authorized to work in the US?",
        "are you authorized to work in the us",
      ),
    ).toBe(1);
  });

  it("is 0 for unrelated questions", () => {
    expect(
      questionSimilarity("Salary expectations", "Describe a project you are proud of."),
    ).toBe(0);
  });

  it("does not rate a short question highly against a long one it appears in", () => {
    const score = questionSimilarity(
      "Sponsorship?",
      "Will you now or in the future require sponsorship for employment visa status?",
    );
    expect(score).toBeLessThan(MATCH_THRESHOLD);
  });

  it("handles empty input without dividing by zero", () => {
    expect(questionSimilarity("", "anything")).toBe(0);
    expect(questionSimilarity("the and of", "anything")).toBe(0);
  });
});

describe("findAnswer", () => {
  it("finds the answer to a question asked verbatim", () => {
    const match = findAnswer("Are you authorized to work in the US?", ENTRIES);
    expect(match?.entry.id).toBe("auth");
    expect(match?.exact).toBe(true);
  });

  it("finds it despite punctuation and capitalization differences", () => {
    const match = findAnswer("ARE YOU AUTHORIZED TO WORK IN THE US", ENTRIES);
    expect(match?.entry.id).toBe("auth");
  });

  it("returns null rather than the closest thing it could find", () => {
    // Shares "interested" and "role" with the stored "why" question, but is a
    // different question entirely.
    expect(findAnswer("Which roles are you interested in relocating for?", ENTRIES)).toBeNull();
    expect(findAnswer("What is your favourite programming language?", ENTRIES)).toBeNull();
  });

  it("does not confuse the two legal questions with each other", () => {
    const sponsorship = findAnswer(
      "Will you now or in the future require sponsorship?",
      ENTRIES,
    );
    expect(sponsorship?.entry.id).toBe("sponsorship");

    const authorization = findAnswer("Are you authorized to work in the US?", ENTRIES);
    expect(authorization?.entry.id).toBe("auth");
  });

  it("returns null when the bank is empty", () => {
    expect(findAnswer("Anything at all?", [])).toBeNull();
  });

  it("can be asked for a looser match explicitly", () => {
    // The caller must opt in to a lower bar, so a loose match can never happen
    // by accident.
    const loose = findAnswer("Are you authorized to work?", ENTRIES, 0.5);
    expect(loose?.entry.id).toBe("auth");
    expect(findAnswer("Are you authorized to work?", ENTRIES)).toBeNull();
  });
});

describe("SUGGESTED_QUESTIONS", () => {
  it("covers the list in spec §16", () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(7);
    const questions = SUGGESTED_QUESTIONS.map((item) => item.question.toLowerCase());
    expect(questions.some((q) => q.includes("authorized"))).toBe(true);
    expect(questions.some((q) => q.includes("sponsorship"))).toBe(true);
    expect(questions.some((q) => q.includes("salary"))).toBe(true);
  });

  it("marks the work-authorization questions as legal ones", () => {
    const legal = SUGGESTED_QUESTIONS.filter((item) => item.isLegal);
    expect(legal).toHaveLength(2);
  });
});
