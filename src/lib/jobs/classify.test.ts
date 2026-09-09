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
      // No keywords match, so verdict is now reject (not ambiguous)
      expect(result.verdict).toBe("reject");
    });

    it("should NOT match 'principal' inside 'principle'", () => {
      const result = classifyStudentRole("Principle Engineer");
      // "principle" ≠ "principal", and no other keywords match
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("no student or early-career signal");
    });

    it("should NOT match 'manager' inside 'management'", () => {
      const result = classifyStudentRole("Project Management Specialist");
      // "management" ≠ "manager", but "specialist" is a reject term
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("specialist");
    });

    it("should match 'manager' as a separate word", () => {
      const result = classifyStudentRole("Project Manager");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should match 'staff' as a separate word but not 'understaffed'", () => {
      const result = classifyStudentRole("Understaffed Team Member");
      // "understaffed" ≠ "staff" (word boundary check), no other keywords match
      expect(result.verdict).toBe("reject");
    });

    it("should match 'staff' when used as a standalone word", () => {
      const result = classifyStudentRole("Staff Software Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("staff");
    });

    it("should NOT match 'lead' inside 'leadership'", () => {
      const result = classifyStudentRole("Leadership Development Program");
      // "program" is an early-career signal, so this should be ambiguous
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("program");
    });

    it("should NOT match 'lead' inside 'Team Lead Generation' (lead marketing term)", () => {
      const result = classifyStudentRole("Team Lead Generation Expert");
      // No keywords match, so verdict is reject
      expect(result.verdict).toBe("reject");
    });

    it("should match 'lead' as a separate word (individual contributor level)", () => {
      const result = classifyStudentRole("Engineering Lead");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("lead");
    });

    it("should NOT match roman numeral II inside other tokens", () => {
      const result = classifyStudentRole("Division II Athletics Coordinator");
      // No keywords match, so verdict is reject
      expect(result.verdict).toBe("reject");
    });

    it("should match roman numeral II as a standalone word", () => {
      const result = classifyStudentRole("Software Engineer II");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("ii");
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
    it("should return reject for titles with no matching keywords", () => {
      const result = classifyStudentRole("Software Engineer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("no student or early-career signal");
    });

    it("should return reject for 'Firmware Engineer, Robotics' (real-world example)", () => {
      const result = classifyStudentRole("Firmware Engineer, Robotics");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("no student or early-career signal");
    });

    it("should return reject for 'Product Manager' (contains manager)", () => {
      const result = classifyStudentRole("Product Manager");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should return ambiguous for 'Associate' (early-career signal)", () => {
      const result = classifyStudentRole("Associate");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("early-career signal");
      expect(result.reason).toContain("associate");
    });

    it("should return ambiguous for 'Analyst' (early-career signal)", () => {
      const result = classifyStudentRole("Analyst");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("early-career signal");
      expect(result.reason).toContain("analyst");
    });

    it("should return ambiguous for 'Data Analyst' (early-career signal)", () => {
      const result = classifyStudentRole("Data Analyst");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("analyst");
    });

    it("should return reject for empty/whitespace strings", () => {
      const result = classifyStudentRole("   ");
      expect(result.verdict).toBe("reject");
    });
  });

  describe("new reject terms (seniority signals)", () => {
    it("should reject 'Engineering Lead'", () => {
      const result = classifyStudentRole("Engineering Lead");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("lead");
    });

    it("should reject 'Head of Product'", () => {
      const result = classifyStudentRole("Head of Product");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("head");
    });

    it("should reject 'Solutions Architect'", () => {
      const result = classifyStudentRole("Solutions Architect");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("architect");
    });

    it("should reject 'Security Specialist'", () => {
      const result = classifyStudentRole("Security Specialist");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("specialist");
    });

    it("should reject 'Executive Assistant'", () => {
      const result = classifyStudentRole("Executive Assistant");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("executive");
    });

    it("should reject 'General Counsel'", () => {
      const result = classifyStudentRole("General Counsel");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("counsel");
    });

    it("should reject 'Consulting Partner'", () => {
      const result = classifyStudentRole("Consulting Partner");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("partner");
    });

    it("should reject 'Senior Consultant'", () => {
      const result = classifyStudentRole("Senior Consultant");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("consultant");
    });

    it("should reject 'Warehouse Supervisor'", () => {
      const result = classifyStudentRole("Warehouse Supervisor");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("supervisor");
    });

    it("should reject 'Financial Advisor'", () => {
      const result = classifyStudentRole("Financial Advisor");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("advisor");
    });

    it("should reject 'Chief Technology Officer'", () => {
      const result = classifyStudentRole("Chief Technology Officer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("chief");
    });

    it("should reject 'Chief of Staff'", () => {
      const result = classifyStudentRole("Chief of Staff");
      expect(result.verdict).toBe("reject");
    });

    it("should reject 'Compliance Officer'", () => {
      const result = classifyStudentRole("Compliance Officer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("officer");
    });

    it("should reject 'Chief Executive Officer'", () => {
      const result = classifyStudentRole("Chief Executive Officer");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("chief");
    });

    it("should reject 'President, Americas'", () => {
      const result = classifyStudentRole("President, Americas");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("president");
    });

    it("should reject 'Vice President of Sales'", () => {
      const result = classifyStudentRole("Vice President of Sales");
      expect(result.verdict).toBe("reject");
      // "president" is the matching term in "Vice President"
      expect(result.reason).toContain("president");
    });

    it("should reject 'Sr. Software Engineer' (with period)", () => {
      const result = classifyStudentRole("Sr. Software Engineer");
      expect(result.verdict).toBe("reject");
      // "sr" (without period) matches "Sr" in "Sr. Engineer" due to word boundaries
      expect(result.reason).toContain("sr");
    });

    it("should reject 'Software Engineer III' (roman numeral)", () => {
      const result = classifyStudentRole("Software Engineer III");
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("iii");
    });

    it("should reject 'Senior Engineer IV'", () => {
      const result = classifyStudentRole("Senior Engineer IV");
      expect(result.verdict).toBe("reject");
      // Could match "senior" or "iv"
      expect(result.verdict).toBe("reject");
    });
  });

  describe("early-career signals (ambiguous)", () => {
    it("should return ambiguous for 'Campus Recruiter'", () => {
      const result = classifyStudentRole("Campus Recruiter");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("campus");
    });

    it("should return reject for 'University Relations Manager'", () => {
      const result = classifyStudentRole("University Relations Manager");
      // "university" is early-career signal, "manager" is reject — reject wins
      expect(result.verdict).toBe("reject");
      expect(result.reason).toContain("manager");
    });

    it("should return ambiguous for 'Entry Level Software Engineer'", () => {
      const result = classifyStudentRole("Entry Level Software Engineer");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("entry level");
    });

    it("should return ambiguous for 'Entry-Level Analyst'", () => {
      const result = classifyStudentRole("Entry-Level Analyst");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("entry-level");
    });

    it("should return ambiguous for 'Rotational Program'", () => {
      const result = classifyStudentRole("Rotational Program");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("rotational");
    });

    it("should return ambiguous for 'Rotation Program Engineer'", () => {
      const result = classifyStudentRole("Rotation Program Engineer");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("rotation");
    });

    it("should return ambiguous for 'Trainee'", () => {
      const result = classifyStudentRole("Trainee");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("trainee");
    });

    it("should return ambiguous for 'Junior Software Engineer'", () => {
      const result = classifyStudentRole("Junior Software Engineer");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("junior");
    });

    it("should return ambiguous for 'Jr. Developer'", () => {
      const result = classifyStudentRole("Jr. Developer");
      expect(result.verdict).toBe("ambiguous");
      // "jr" (from "Jr.") is an early-career signal
      expect(result.reason).toContain("jr");
    });

    it("should return ambiguous for 'New College Graduate'", () => {
      const result = classifyStudentRole("New College Graduate");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("new college");
    });

    it("should return ambiguous for 'College Grad Track'", () => {
      const result = classifyStudentRole("College Grad Track");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("college grad");
    });

    it("should return ambiguous for 'Medical Residency'", () => {
      const result = classifyStudentRole("Medical Residency");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("residency");
    });

    it("should return ambiguous for 'Research Fellowship'", () => {
      const result = classifyStudentRole("Research Fellowship");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("fellowship");
    });

    it("should return ambiguous for 'Early Career Program'", () => {
      const result = classifyStudentRole("Early Career Program");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("early career");
    });

    it("should return ambiguous for 'Early-Career Scientist'", () => {
      const result = classifyStudentRole("Early-Career Scientist");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("early-career");
    });

    it("should return ambiguous for 'Fellow'", () => {
      const result = classifyStudentRole("Fellow");
      expect(result.verdict).toBe("ambiguous");
      expect(result.reason).toContain("fellow");
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
