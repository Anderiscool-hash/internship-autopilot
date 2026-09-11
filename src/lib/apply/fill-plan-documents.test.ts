/**
 * Planning the file-upload fields.
 *
 * The rule under test: a document is attached only when the label names it
 * and that document is saved. Everything else is a reported gap, because the
 * wrong file in an upload slot looks answered and is harder for a reviewing
 * human to catch than an empty one.
 */

import { describe, expect, it } from "vitest";
import { buildFillPlan, type FillableField, type FillProfile } from "./fill-plan";

const profile: FillProfile = {
  name: "Ana Ayala",
  email: "ana@example.com",
  phone: null,
  address: null,
  school: null,
  degree: null,
  graduationDate: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
};

function fileField(label: string): FillableField {
  return {
    label,
    kind: "file",
    required: true,
    elementId: "resume-input",
    name: "resume",
    inputType: "file",
    options: [],
  };
}

const resume = {
  absolutePath: "/storage/resume-abc.pdf",
  filename: "ana-resume.pdf",
  mimeType: "application/pdf",
};

describe("buildFillPlan — documents", () => {
  it("attaches the saved resume to a resume field", () => {
    const plan = buildFillPlan([fileField("Resume/CV")], profile, [], { RESUME: resume });

    expect(plan.planned[0]?.action).toEqual({
      type: "attach",
      path: resume.absolutePath,
      // The name the candidate gave it, not the content-addressed name on
      // disk — an employer should not receive an attachment named after a hash.
      filename: resume.filename,
      mimeType: "application/pdf",
      kind: "RESUME",
    });
    expect(plan.planned[0]?.source).toBe("document");
  });

  it("says which document is missing rather than attaching another", () => {
    // A cover letter field with only a resume on file must not get the resume.
    const plan = buildFillPlan([fileField("Cover Letter")], profile, [], { RESUME: resume });

    const action = plan.planned[0]?.action;
    expect(action?.type).toBe("skip");
    expect(action).toMatchObject({ reason: expect.stringContaining("cover letter") });
  });

  it("leaves an unlabelled upload alone even with a resume on file", () => {
    const plan = buildFillPlan([fileField("Attach a file")], profile, [], { RESUME: resume });

    const action = plan.planned[0]?.action;
    expect(action?.type).toBe("skip");
    expect(action).toMatchObject({ reason: expect.stringContaining("Cannot tell") });
  });

  it("reports the upload as a blocking gap when nothing is saved", () => {
    const plan = buildFillPlan([fileField("Resume")], profile, [], {});

    expect(plan.planned[0]?.action.type).toBe("skip");
    expect(plan.blockingGaps).toContain("Resume");
  });

  it("does not count an attached document as a blocking gap", () => {
    const plan = buildFillPlan([fileField("Resume")], profile, [], { RESUME: resume });
    expect(plan.blockingGaps).not.toContain("Resume");
  });
});
