/**
 * Job deduplication via fingerprinting.
 *
 * This module provides a deterministic way to identify duplicate job postings
 * across multiple discovery sources, preventing the same job from being stored
 * and analyzed twice.
 *
 * See spec section 8: Deduplication.
 */

import { createHash } from "node:crypto";

/**
 * Separator placed between the two inputs before hashing.
 *
 * It is a NUL character rather than a printable one on purpose.
 * With a printable separator like "+", company "a+b" / job "c" would hash to
 * exactly the same value as company "a" / job "b+c" — two different jobs
 * sharing one fingerprint. Since the fingerprint is what stops us applying to
 * the same job twice, a collision here is not cosmetic. A NUL cannot appear in
 * a company name or an ATS job ID, so the split point stays unambiguous.
 */
const FIELD_SEPARATOR = String.fromCharCode(0);

/**
 * Normalize a string for fingerprinting.
 *
 * Converts input to lowercase, trims leading/trailing whitespace, and collapses
 * internal whitespace sequences into single spaces. This ensures that variations
 * in formatting ("Acme  Corp" vs "acme corp") produce the same hash.
 *
 * Why this matters: Job postings may be scraped from different sources with
 * different formatting, but they represent the same employer and role. Without
 * normalization, we'd store duplicates and waste resources analyzing the same
 * job twice.
 *
 * @param input - String to normalize
 * @returns Normalized string
 */
function normalizeForFingerprint(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Generate a fingerprint for a job posting.
 *
 * Creates a SHA256 hash of the company name and canonical job ID.
 * This fingerprint uniquely identifies a job posting regardless of which
 * source discovered it, enabling deduplication across all monitored platforms.
 *
 * Why fingerprints work:
 * - Company + Job ID are stable identifiers set by the employer.
 * - Same company + same job ID = always the same job posting.
 * - Different jobs have different IDs (even if title/description is similar).
 * - Normalization handles formatting variations from different scrapers.
 *
 * Assumptions:
 * - sourceJobId is unique within a company's career system.
 * - Company name is available and meaningful.
 *
 * @param companyName - Employer name (normalized internally)
 * @param canonicalJobId - The employer's unique ID for this posting (normalized internally)
 * @returns SHA256 hex string fingerprint
 */
export function jobFingerprint(
  companyName: string,
  canonicalJobId: string
): string {
  // Normalize both inputs to handle variations in whitespace and casing
  const normalizedCompany = normalizeForFingerprint(companyName);
  const normalizedJobId = normalizeForFingerprint(canonicalJobId);

  // Combine inputs in a deterministic order (company first, then job ID)
  const combined = `${normalizedCompany}${FIELD_SEPARATOR}${normalizedJobId}`;

  // Create SHA256 hash
  const hash = createHash("sha256");
  hash.update(combined);

  // Return hex-encoded hash
  return hash.digest("hex");
}
