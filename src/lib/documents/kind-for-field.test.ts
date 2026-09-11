import { describe, expect, it } from "vitest";
import { documentKindForField } from "./kind-for-field";

describe("documentKindForField", () => {
  it("recognizes the resume field under its usual names", () => {
    expect(documentKindForField("Resume")).toBe("RESUME");
    expect(documentKindForField("Resume/CV")).toBe("RESUME");
    expect(documentKindForField("Résumé")).toBe("RESUME");
    expect(documentKindForField("Upload your CV")).toBe("RESUME");
  });

  it("recognizes the cover letter", () => {
    expect(documentKindForField("Cover Letter")).toBe("COVER_LETTER");
    expect(documentKindForField("Cover letter (optional)")).toBe("COVER_LETTER");
  });

  it("recognizes a transcript", () => {
    expect(documentKindForField("Unofficial transcript")).toBe("TRANSCRIPT");
  });

  // The important one. A label naming two documents cannot tell you which
  // input you are looking at, and attaching the wrong file is worse than
  // attaching none — it looks answered.
  it("attaches nothing when the label names more than one document", () => {
    expect(documentKindForField("Attach your resume and cover letter")).toBeNull();
    expect(documentKindForField("Resume or cover letter")).toBeNull();
  });

  // "Attach a file" is a portfolio on one form and a writing sample on the
  // next. Guessing resume would be wrong often enough to matter.
  it("attaches nothing to an unlabelled upload", () => {
    expect(documentKindForField("Attach a file")).toBeNull();
    expect(documentKindForField("Upload")).toBeNull();
    expect(documentKindForField("Portfolio")).toBeNull();
    expect(documentKindForField("Writing sample")).toBeNull();
  });

  it("is not fooled by the word inside another word", () => {
    // "resumed" is not "resume".
    expect(documentKindForField("Date you resumed study")).toBeNull();
  });
});
