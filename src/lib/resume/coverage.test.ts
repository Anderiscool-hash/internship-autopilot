import { describe, expect, it } from "vitest";
import { scoreResumeCoverage } from "./coverage";

describe("scoreResumeCoverage", () => {
  it("weights required and preferred coverage at 80/20", () => {
    const result = scoreResumeCoverage(
      "Built services with Python.\nDeployed them on AWS and Docker.",
      { required: ["Python", "Go"], preferred: ["AWS", "Docker"] },
    );
    expect(result.score).toBe(60);
    expect(result.items.map((item) => item.status)).toEqual([
      "matched", "missing", "matched", "matched",
    ]);
  });

  it("returns exact evidence lines, never inferred qualifications", () => {
    const result = scoreResumeCoverage(
      "Skills: TypeScript, C++\nBuilt a compiler in TypeScript.",
      { required: ["TypeScript", "C++"] },
    );
    expect(result.items[0]?.evidence).toEqual([
      "Skills: TypeScript, C++", "Built a compiler in TypeScript.",
    ]);
    expect(result.items[1]?.evidence).toEqual(["Skills: TypeScript, C++"]);
  });

  it("uses boundaries and supports C++, C#, and .NET", () => {
    const result = scoreResumeCoverage(
      "Google Cloud\nRuby\nC++\nC#\n.NET",
      { required: ["Go", "R", "C++", "C#", ".NET"] },
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "missing", "missing", "matched", "matched", "matched",
    ]);
  });

  it("dedupes with required priority winning and retains stable ordering", () => {
    const result = scoreResumeCoverage("Python", {
      preferred: [" python ", "AWS", "React"],
      required: ["PYTHON", "Python", "SQL"],
    });
    expect(result.items).toEqual([
      { requirement: "PYTHON", priority: "required", status: "matched", evidence: ["Python"] },
      { requirement: "SQL", priority: "required", status: "missing", evidence: [] },
      { requirement: "AWS", priority: "preferred", status: "missing", evidence: [] },
      { requirement: "React", priority: "preferred", status: "missing", evidence: [] },
    ]);
  });

  it("renormalizes one class and distinguishes unknown from empty text", () => {
    expect(scoreResumeCoverage("Python", { required: ["Python", "AWS"] }).score).toBe(50);
    expect(scoreResumeCoverage("AWS", { preferred: ["AWS"] }).score).toBe(100);
    const unknown = scoreResumeCoverage(undefined, { required: ["Python"] });
    expect(unknown.score).toBeNull();
    expect(unknown.items[0]?.status).toBe("unknown");
    const empty = scoreResumeCoverage("  ", { required: ["Python"] });
    expect(empty.score).toBe(0);
    expect(empty.items[0]?.status).toBe("missing");
  });
});
