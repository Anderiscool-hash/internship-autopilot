/**
 * Tests for job fingerprinting.
 *
 * Ensures that:
 * - Identical inputs produce identical fingerprints
 * - Different inputs produce different fingerprints
 * - Normalization works (whitespace and casing variations)
 * - SHA256 is cryptographically sound for this use case
 */

import { describe, it, expect } from "vitest";
import { jobFingerprint } from "./fingerprint";

describe("jobFingerprint", () => {
  describe("identical inputs", () => {
    it("should produce the same fingerprint for identical inputs", () => {
      const company = "Acme Corporation";
      const jobId = "job_12345";

      const fingerprint1 = jobFingerprint(company, jobId);
      const fingerprint2 = jobFingerprint(company, jobId);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it("should return a valid SHA256 hex string (64 characters)", () => {
      const fingerprint = jobFingerprint("Test Company", "job_001");
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("normalization", () => {
    it("should produce identical fingerprints regardless of company name casing", () => {
      const jobId = "job_12345";

      const fp1 = jobFingerprint("Acme Corp", jobId);
      const fp2 = jobFingerprint("ACME CORP", jobId);
      const fp3 = jobFingerprint("acme corp", jobId);

      expect(fp1).toBe(fp2);
      expect(fp2).toBe(fp3);
    });

    it("should produce identical fingerprints regardless of internal whitespace", () => {
      const jobId = "job_12345";

      const fp1 = jobFingerprint("Acme Corp", jobId);
      const fp2 = jobFingerprint("Acme  Corp", jobId); // Double space
      const fp3 = jobFingerprint("Acme   Corp", jobId); // Triple space

      expect(fp1).toBe(fp2);
      expect(fp2).toBe(fp3);
    });

    it("should produce identical fingerprints despite leading/trailing whitespace", () => {
      const jobId = "job_12345";

      const fp1 = jobFingerprint("Acme Corp", jobId);
      const fp2 = jobFingerprint("  Acme Corp  ", jobId);

      expect(fp1).toBe(fp2);
    });

    it("should normalize the job ID as well", () => {
      const company = "Acme Corp";

      const fp1 = jobFingerprint(company, "job_12345");
      const fp2 = jobFingerprint(company, "JOB_12345");
      const fp3 = jobFingerprint(company, "  job_12345  ");

      expect(fp1).toBe(fp2);
      expect(fp2).toBe(fp3);
    });

    it("should produce identical fingerprints for whitespace variations in both fields", () => {
      const fp1 = jobFingerprint("Acme  Corp", "job  123");
      const fp2 = jobFingerprint("ACME CORP", "JOB 123");

      expect(fp1).toBe(fp2);
    });
  });

  describe("different inputs", () => {
    it("should produce different fingerprints for different company names", () => {
      const jobId = "job_12345";

      const fp1 = jobFingerprint("Acme Corp", jobId);
      const fp2 = jobFingerprint("Tech Startup", jobId);

      expect(fp1).not.toBe(fp2);
    });

    it("should produce different fingerprints for different job IDs", () => {
      const company = "Acme Corp";

      const fp1 = jobFingerprint(company, "job_12345");
      const fp2 = jobFingerprint(company, "job_67890");

      expect(fp1).not.toBe(fp2);
    });

    it("should produce different fingerprints for different company and job ID", () => {
      const fp1 = jobFingerprint("Acme Corp", "job_12345");
      const fp2 = jobFingerprint("Tech Startup", "job_67890");

      expect(fp1).not.toBe(fp2);
    });
  });

  describe("real-world scenarios", () => {
    it("should handle company names with apostrophes", () => {
      const fp1 = jobFingerprint("McDonald's", "job_001");
      const fp2 = jobFingerprint("McDonald's", "job_001");

      expect(fp1).toBe(fp2);
    });

    it("should handle company names with special characters", () => {
      const fp1 = jobFingerprint("AT&T", "job_001");
      const fp2 = jobFingerprint("AT&T", "job_001");

      expect(fp1).toBe(fp2);
    });

    it("should handle job IDs from different ATS platforms", () => {
      // Greenhouse ID
      const fpGreenhouse1 = jobFingerprint("Google", "12345678");
      const fpGreenhouse2 = jobFingerprint("Google", "12345678");

      expect(fpGreenhouse1).toBe(fpGreenhouse2);

      // Lever ID (UUID-like)
      const fpLever1 = jobFingerprint("Google", "abc-def-ghi-jkl");
      const fpLever2 = jobFingerprint("Google", "abc-def-ghi-jkl");

      expect(fpLever1).toBe(fpLever2);

      // Different ATS IDs should produce different fingerprints
      expect(fpGreenhouse1).not.toBe(fpLever1);
    });

    it("should handle the same job posted by multiple scrapers", () => {
      // Simulates the same job discovered from Greenhouse and Lever
      const companyName = "Stripe";
      const greenHouseId = "123456"; // From Greenhouse
      const leverId = "abc-def-ghi"; // From Lever

      // IMPORTANT: These are different IDs, so fingerprints differ
      // (dedup only works within the same company's systems,
      // or if we normalize IDs to canonical form upstream)
      const fpGreenhouse = jobFingerprint(companyName, greenHouseId);
      const fpLever = jobFingerprint(companyName, leverId);

      expect(fpGreenhouse).not.toBe(fpLever);

      // But the same Greenhouse posting discovered twice should match
      const fpGreenhouse2 = jobFingerprint(companyName, greenHouseId);
      expect(fpGreenhouse).toBe(fpGreenhouse2);
    });
  });
});
