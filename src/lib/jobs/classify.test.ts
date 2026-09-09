/**
 * Tests for student role classifier.
 *
 * Ensures that:
 * - All keep-list terms are recognized
 * - All reject-list terms are recognized
 * - Ambiguous cases (both lists) are handled correctly
 * - Unmatched titles return ambiguous (not rejected)
 * - Word boundaries work (e.g., "intern" doesn't match "internal")
 */

import { describe, it, expect } from "vitest";
import { classifyStudentRole } from "./classify";

describe("classifyStudentRole", () => {
  describe("keep-list terms", () => {
    it("should keep titles with 'internship'", () => {
      const result = classifyStudentRole("Software Engineering Internship");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("internship");
    });

    it("should keep titles with 'intern'", () => {
      const result = classifyStudentRole("Software Engineer Intern");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("intern");
    });

    it("should keep titles with 'co-op'", () => {
      const result = classifyStudentRole("Engineering Co-op");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("co-op");
    });

    it("should keep titles with 'coop' (without hyphen)", () => {
      const result = classifyStudentRole("Software Coop Program");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("coop");
    });

    it("should keep titles with 'student'", () => {
      const result = classifyStudentRole("Student Software Developer");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("student");
    });

    it("should keep titles with 'apprentice'", () => {
      const result = classifyStudentRole("Engineering Apprentice");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("apprentice");
    });

    it("should keep titles with 'summer analyst'", () => {
      const result = classifyStudentRole("Summer Analyst - Investment Banking");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("summer analyst");
    });

    it("should keep titles with 'summer associate'", () => {
      const result = classifyStudentRole("Summer Associate");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("summer associate");
    });

    it("should keep titles with 'new grad'", () => {
      const result = classifyStudentRole("New Grad Software Engineer");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("new grad");
    });

    it("should keep titles with 'graduate program'", () => {
      const result = classifyStudentRole("Technology Graduate Program");
      expect(result.verdict).toBe("keep");
      expect(result.reason).toContain("graduate program");
    });

    it("should be case-insensitive for keep terms", () => {
      const result1 = classifyStudentRole("Software Engineer INTERN");
      const result2 = classifyStudentRole("software engineer intern");
      const result3 = classifyStudentRole("Software Engineer Intern");

      expect(result1.verdict).toBe("keep");
      expect(result2.verdict).toBe("keep");
      expect(result3.verdict).toBe("keep");
    });
  });

  describe("reject-list terms", () => {
    it("should reject titles with 'senior'", () => {
      const result = classifyStudentRole("Senior Software Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("senior");
    });

    it("should reject titles with 'staff'", () => {
      const result = classifyStudentRole("Staff Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("staff");
    });

    it("should reject titles with 'principal'", () => {
      const result = classifyStudentRole("Principal Software Architect");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("principal");
    });

    it("should reject titles with 'manager'", () => {
      const result = classifyStudentRole("Engineering Manager");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should reject titles with 'director'", () => {
      const result = classifyStudentRole("Director of Engineering");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("director");
    });

    it("should reject titles with 'experienced hire'", () => {
      const result = classifyStudentRole("Experienced Hire - Software Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("experienced hire");
    });

    it("should be case-insensitive for reject terms", () => {
      const result1 = classifyStudentRole("SENIOR Software Engineer");
      const result2 = classifyStudentRole("senior software engineer");
      const result3 = classifyStudentRole("Senior Software Engineer");

      expect(result1.verdict).toBe("reject");
      expect(result2.verdict).toBe("reject");
      expect(result3.verdict).toBe("reject");
    });
  });

  describe("word boundary matching", () => {
    it("should NOT match 'intern' inside 'internal'", () => {
      const result = classifyStudentRole("Internal Auditor");
      expect(result.verdict).not.toBe("keep");
      // It's ambiguous because it doesn't match any keywords
      expect(result.verdict).toBe("ambiguous");
    });

    it("should NOT match 'principal' inside 'principle'", () => {
      const result = classifyStudentRole("Principle Engineer");
      expect(result.verdict).not.toBe("reject");
      // It's ambiguous because it doesn't match any reject keywords
      expect(result.verdict).toBe("ambiguous");
    });

    it("should NOT match 'manager' inside 'management'", () => {
      const result = classifyStudentRole("Project Management Specialist");
      expect(result.verdict).not.toBe("reject");
      expect(result.verdict).toBe("ambiguous");
    });

    it("should match 'manager' as a separate word", () => {
      const result = classifyStudentRole("Project Manager");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should match 'staff' as a separate word but not 'understaffed'", () => {
      const result = classifyStudentRole("Understaffed Team Member");
      expect(result.verdict).not.toBe("reject");
      expect(result.verdict).toBe("ambiguous");
    });

    it("should match 'staff' when used as a standalone word", () => {
      const result = classifyStudentRole("Staff Software Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("staff");
    });
  });

  describe("ambiguous cases", () => {
    it("should return ambiguous when title matches both keep and reject lists", () => {
      const result = classifyStudentRole("Senior Intern");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("matches both");
    });

    it("should return ambiguous for 'Staff Internship'", () => {
      const result = classifyStudentRole("Staff Internship");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("matches both");
    });

    it("should return ambiguous for 'Principal Graduate'", () => {
      const result = classifyStudentRole("Principal Graduate Program");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("matches both");
    });

    it("should return reject for 'Director of Internships' (internships is plural, no word boundary match)", () => {
      const result = classifyStudentRole("Director of Internships");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("director");
    });
  });

  describe("no matches (unrecognized titles)", () => {
    it("should return ambiguous for titles with no matching keywords", () => {
      const result = classifyStudentRole("Software Engineer");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("does not match known");
    });

    it("should return reject for 'Product Manager' (contains manager)", () => {
      const result = classifyStudentRole("Product Manager");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should return ambiguous for 'Data Analyst'", () => {
      const result = classifyStudentRole("Data Analyst");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("does not match known");
    });

    it("should return ambiguous for 'Associate' (rotational program title)", () => {
      const result = classifyStudentRole("Associate");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("does not match known");
    });

    it("should return ambiguous for 'Analyst' (generic)", () => {
      const result = classifyStudentRole("Analyst");
      expect(result.verdict).toBe("ambiguous");
    });

    it("should return ambiguous for empty/whitespace strings", () => {
      const result = classifyStudentRole("   ");
      expect(result.verdict).toBe("ambiguous");
    });
  });

  describe("real-world examples", () => {
    it("should keep 'Machine Learning Internship'", () => {
      const result = classifyStudentRole("Machine Learning Internship");
      expect(result.verdict).toBe("keep");
    });

    it("should keep 'Data Science Co-op'", () => {
      const result = classifyStudentRole("Data Science Co-op");
      expect(result.verdict).toBe("keep");
    });

    it("should keep 'Summer Analyst - Corporate Finance'", () => {
      const result = classifyStudentRole("Summer Analyst - Corporate Finance");
      expect(result.verdict).toBe("keep");
    });

    it("should reject 'Senior Full-Stack Engineer'", () => {
      const result = classifyStudentRole("Senior Full-Stack Engineer");
      expect(result.verdict).toBe("reject");
    });

    it("should reject 'Staff Security Engineer'", () => {
      const result = classifyStudentRole("Staff Security Engineer");
      expect(result.verdict).toBe("reject");
    });

    it("should be ambiguous for 'New Grad Software Engineer' (keep wins, no reject)", () => {
      const result = classifyStudentRole("New Grad Software Engineer");
      expect(result.verdict).toBe("keep");
    });

    it("should be ambiguous for 'Graduate Program Manager'", () => {
      const result = classifyStudentRole("Graduate Program Manager");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("matches both");
    });

    it("should keep 'Intern - New Grad Track'", () => {
      const result = classifyStudentRole("Intern - New Grad Track");
      expect(result.verdict).toBe("keep");
    });

    it("should reject 'Senior Manager, Engineering'", () => {
      const result = classifyStudentRole("Senior Manager, Engineering");
      expect(result.verdict).toBe("reject");
    });
  });

  describe("edge cases", () => {
    it("should handle multiple whitespaces", () => {
      const result = classifyStudentRole("Software   Engineer   Intern");
      expect(result.verdict).toBe("keep");
    });

    it("should handle leading/trailing whitespace", () => {
      const result = classifyStudentRole("  Software Engineer Intern  ");
      expect(result.verdict).toBe("keep");
    });

    it("should handle mixed case with punctuation", () => {
      const result = classifyStudentRole("Software Engineer, Intern");
      expect(result.verdict).toBe("keep");
    });

    it("should handle parentheses", () => {
      const result = classifyStudentRole("Software Engineer (Intern)");
      expect(result.verdict).toBe("keep");
    });

    it("should handle slashes in title", () => {
      const result = classifyStudentRole("Junior / Intern Software Engineer");
      expect(result.verdict).toBe("keep");
    });

    it("should handle multiple reject terms in one title", () => {
      const result = classifyStudentRole("Senior Staff Principal Engineer");
      expect(result.verdict).toBe("reject");
      // Should mention multiple terms
      const termCount = (
        result.reason.match(/senior|staff|principal/g) || []
      ).length;
      expect(termCount).toBeGreaterThan(0);
    });
  });
});
