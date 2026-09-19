/**
 * Tests for the typo checker.
 *
 * The first three cases are not invented: they are the exact strings a live
 * shadow run typed from the candidate's stored profile onto a real Greenhouse
 * application ("Computer Science & Cyber Secuirty", "108 autum ave") plus the
 * "Kurbenetes" sitting in their skills list. If those three ever stop being
 * caught, this file has stopped doing its job.
 *
 * The rest of the file guards the two ways a spell checker does damage:
 * shouting about correct text, and guessing when it cannot tell.
 */

import { describe, it, expect } from "vitest";
import { checkText, damerauLevenshtein, isKnownWord } from "./check";
import { DICTIONARY, CANONICAL } from "./dictionary";

/** Convenience: just the "word -> suggestion" pairs, for readable assertions. */
function pairs(text: string): string[] {
  return checkText(text).map((item) => `${item.word} -> ${item.suggestion}`);
}

describe("damerauLevenshtein", () => {
  it("is zero for identical strings", () => {
    expect(damerauLevenshtein("security", "security")).toBe(0);
  });

  it("counts a single substitution as one", () => {
    expect(damerauLevenshtein("cat", "cot")).toBe(1);
  });

  it("counts an insertion and a deletion as one each", () => {
    expect(damerauLevenshtein("autum", "autumn")).toBe(1);
    expect(damerauLevenshtein("autumnn", "autumn")).toBe(1);
  });

  it("counts a swap of two neighbouring letters as ONE edit", () => {
    // This is the whole reason the checker uses this distance and not plain
    // Levenshtein, which would score both of these 2 and miss them.
    expect(damerauLevenshtein("ab", "ba")).toBe(1);
    expect(damerauLevenshtein("secuirty", "security")).toBe(1);
  });

  it("scores a letter moved two places as two edits, not one", () => {
    // "Kurbenetes" looks like a swap but is not one: "rbe" against "ber" is a
    // letter moved two positions, which no single edit describes. It costs 2.
    // That is exactly why long words are allowed a distance of 2 - drop that
    // rule and the real typo in the candidate's skills list goes unreported.
    expect(damerauLevenshtein("kurbenetes", "kubernetes")).toBe(2);
  });

  it("handles an empty string as the length of the other", () => {
    expect(damerauLevenshtein("", "linux")).toBe(5);
    expect(damerauLevenshtein("linux", "")).toBe(5);
  });
});

describe("checkText - the real typos that reached an employer", () => {
  it('catches "Secuirty" and suggests "Security"', () => {
    const found = checkText("Computer Science & Cyber Secuirty");
    expect(found).toHaveLength(1);
    expect(found[0]?.word).toBe("Secuirty");
    expect(found[0]?.suggestion).toBe("Security");
  });

  it('catches "Kurbenetes" and restores the vendor casing "Kubernetes"', () => {
    const found = checkText("Docker, Kurbenetes, Terraform");
    expect(found).toHaveLength(1);
    expect(found[0]?.word).toBe("Kurbenetes");
    expect(found[0]?.suggestion).toBe("Kubernetes");
  });

  it('catches "autum" in an address and suggests "autumn"', () => {
    const found = checkText("108 autum ave");
    expect(found).toHaveLength(1);
    expect(found[0]?.word).toBe("autum");
    expect(found[0]?.suggestion).toBe("autumn");
  });

  it("reports the offset of the word in the original text", () => {
    const text = "Computer Science & Cyber Secuirty";
    const found = checkText(text);
    expect(found[0]?.offset).toBe(text.indexOf("Secuirty"));
    expect(text.slice(found[0]?.offset ?? 0, (found[0]?.offset ?? 0) + 8)).toBe("Secuirty");
  });
});

describe("checkText - silence when the answer is not obvious", () => {
  it("says nothing when two dictionary words are equally close", () => {
    // "coud" is one edit from BOTH "cloud" and "could". There is no way to
    // know which was meant, so the checker must not guess.
    expect(damerauLevenshtein("coud", "cloud")).toBe(1);
    expect(damerauLevenshtein("coud", "could")).toBe(1);
    expect(DICTIONARY.has("cloud")).toBe(true);
    expect(DICTIONARY.has("could")).toBe(true);

    expect(checkText("coud")).toEqual([]);
    expect(checkText("I coud deploy the server")).toEqual([]);
  });

  it("prefers the closest word when a further one is also in range", () => {
    // Straight from the candidate's answer bank: "No prefrence". A 9-letter
    // word is allowed a radius of 2, and two dictionary words fall inside it
    // - but they are not tied, so the nearer one wins rather than the checker
    // staying silent about an obvious typo.
    expect(damerauLevenshtein("prefrence", "preference")).toBe(1);
    expect(damerauLevenshtein("prefrence", "reference")).toBe(2);
    expect(pairs("No prefrence")).toEqual(["prefrence -> preference"]);
  });

  it("says nothing about correctly spelled text", () => {
    expect(checkText("Computer Science & Cyber Security")).toEqual([]);
    expect(checkText("Docker, Kubernetes, Terraform, PostgreSQL, Wireshark")).toEqual([]);
    expect(checkText("108 autumn ave")).toEqual([]);
    expect(
      checkText(
        "I am responsible for monitoring network traffic and documenting every incident response.",
      ),
    ).toEqual([]);
  });

  it("says nothing about a word that is nowhere near the dictionary", () => {
    // An unknown surname, company or course code is not a typo of anything.
    expect(checkText("Uniqlo Ayala Quezon")).toEqual([]);
  });

  it("accepts ordinary plurals and tenses without a dictionary entry each", () => {
    expect(isKnownWord("networks")).toBe(true);
    expect(isKnownWord("deployed")).toBe(true);
    expect(isKnownWord("monitoring")).toBe(true);
    expect(isKnownWord("vulnerabilities")).toBe(true);
    expect(checkText("Monitored networks and deployed containers")).toEqual([]);
  });
});

describe("checkText - what it refuses to look at", () => {
  it("skips words under four letters", () => {
    expect(checkText("ave rd st ths")).toEqual([]);
  });

  it("skips anything containing a digit", () => {
    expect(checkText("SOC2 CCNA200 secuirty2")).toEqual([]);
  });

  it("skips URLs, emails and file paths", () => {
    expect(checkText("https://github.com/anderr")).toEqual([]);
    expect(checkText("ayalaander231@gmial.com")).toEqual([]);
    expect(checkText("C:\\Users\\ayala\\resumee.docx")).toEqual([]);
    expect(checkText("src/lib/secuirty/check.ts")).toEqual([]);
  });

  it("skips identifiers and acronyms", () => {
    expect(checkText("getUserNmae")).toEqual([]); // camelCase
    expect(checkText("user_nmae_field")).toEqual([]); // snake_case
    expect(checkText("SIEM OSINT CISSP")).toEqual([]); // ALLCAPS acronyms
  });

  it("looks inside punctuation and hyphens for real words", () => {
    // Trailing punctuation must not hide a typo, and a hyphenated pair is two
    // words rather than one unknown one.
    expect(pairs("Cyber Secuirty, Networking")).toEqual(["Secuirty -> Security"]);
    expect(pairs("cyber-secuirty")).toEqual(["secuirty -> security"]);
  });
});

describe("checkText - casing", () => {
  it("uses the dictionary's casing for technology names", () => {
    expect(pairs("postgersql")).toEqual(["postgersql -> PostgreSQL"]);
  });

  it("keeps the candidate's capitalisation for ordinary words", () => {
    expect(pairs("Seperate mailing address")).toEqual(["Seperate -> Separate"]);
    expect(pairs("seperate mailing address")).toEqual(["seperate -> separate"]);
  });

  it("never returns a suggestion identical to the word", () => {
    for (const suggestion of checkText("Cyber Secuirty and autum ave")) {
      expect(suggestion.suggestion).not.toBe(suggestion.word);
    }
  });
});

describe("checkText - it never mutates anything", () => {
  it("returns the original text untouched to its caller", () => {
    // The function cannot modify a string (strings are immutable in JS), but
    // this test states the contract that matters: what comes back is a list of
    // suggestions, and the text the caller holds is exactly what it passed in.
    const original = "Computer Science & Cyber Secuirty";
    const copy = original.slice();
    const found = checkText(original);

    expect(original).toBe(copy);
    expect(found).toHaveLength(1);
    expect(found[0]?.word).toBe("Secuirty");
    // The suggestion is reported, not applied.
    expect(original).toContain("Secuirty");
  });
});

describe("dictionary", () => {
  it("has no entry shorter than four letters", () => {
    for (const word of DICTIONARY) {
      expect(word.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("maps lowercase keys to properly cased spellings", () => {
    expect(CANONICAL.get("kubernetes")).toBe("Kubernetes");
    expect(CANONICAL.get("postgresql")).toBe("PostgreSQL");
    expect(CANONICAL.get("typescript")).toBe("TypeScript");
    expect(CANONICAL.get("autumn")).toBe("autumn");
  });

  it("is keyed entirely in lowercase", () => {
    for (const key of CANONICAL.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});
