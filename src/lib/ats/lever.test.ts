/**
 * Tests for the Lever job-board client.
 *
 * We never hit the real network here - `globalThis.fetch` is replaced with
 * a fake for every test so these run instantly and don't depend on Lever
 * being up. Each test feeds the parser a small, realistic fixture (or a
 * deliberately broken one) and checks what comes out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLeverJobs, LeverApiError } from "./lever";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchLeverJobs", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a valid Lever response into CanonicalJob objects", async () => {
    const fixture = [
      {
        id: "abc-123",
        text: "Product Management Intern",
        hostedUrl: "https://jobs.lever.co/acme/abc-123",
        applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
        createdAt: 1704067200000, // 2024-01-01T00:00:00.000Z
        categories: {
          location: "San Francisco, CA",
          commitment: "Internship",
          team: "Product",
        },
        workplaceType: "hybrid",
        description: "<p>Join our product team.</p>",
        lists: [
          { text: "Requirements", content: "<ul><li>Excel</li><li>SQL</li></ul>" },
        ],
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchLeverJobs("acme", "Acme Corp");

    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.companyName).toBe("Acme Corp");
    expect(job.source).toBe("Lever");
    expect(job.atsType).toBe("lever");
    expect(job.sourceJobId).toBe("abc-123");
    expect(job.title).toBe("Product Management Intern");
    expect(job.location).toBe("San Francisco, CA");
    expect(job.remoteType).toBe("hybrid");
    expect(job.employmentType).toBe("Internship");
    expect(job.canonicalUrl).toBe("https://jobs.lever.co/acme/abc-123");
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.currency).toBeNull();
    expect(job.sourcePostedAt).toEqual(new Date(1704067200000));

    // HTML from both the intro and the "lists" sections should be stripped.
    expect(job.description).not.toContain("<");
    expect(job.description).toContain("Join our product team.");
    expect(job.description).toContain("Requirements");
    expect(job.description).toContain("- Excel");
    expect(job.description).toContain("- SQL");
  });

  it("falls back to applyUrl when hostedUrl is missing, and maps remote/onsite correctly", async () => {
    const fixture = [
      {
        id: "xyz-789",
        text: "Data Science Intern",
        applyUrl: "https://jobs.lever.co/acme/xyz-789/apply",
        createdAt: null,
        categories: { location: "Remote", commitment: "Internship" },
        workplaceType: "remote",
        description: "<p>Analyze things.</p>",
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchLeverJobs("acme", "Acme Corp");
    expect(jobs[0]!.canonicalUrl).toBe("https://jobs.lever.co/acme/xyz-789/apply");
    expect(jobs[0]!.remoteType).toBe("remote");
    expect(jobs[0]!.sourcePostedAt).toBeNull();
  });

  it("throws LeverApiError instead of returning an empty array when the response shape is wrong", async () => {
    // Lever should return an array; an object here is not "zero jobs", it's
    // a broken/unexpected response and must not look like a quiet board.
    const malformed = { jobs: [] };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(malformed));

    await expect(fetchLeverJobs("acme", "Acme Corp")).rejects.toThrow(LeverApiError);
  });

  it("throws a non-retryable LeverApiError on 404 (board gone)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 404));

    await expect(fetchLeverJobs("ghost-co", "Ghost Co")).rejects.toMatchObject({
      name: "LeverApiError",
      retryable: false,
      statusCode: 404,
    });
  });

  it("throws a retryable LeverApiError on 429 (rate limited)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 429));

    await expect(fetchLeverJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "LeverApiError",
      retryable: true,
      statusCode: 429,
    });
  });

  it("throws a retryable LeverApiError on 5xx (server error)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 502));

    await expect(fetchLeverJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "LeverApiError",
      retryable: true,
      statusCode: 502,
    });
  });

  it("throws a retryable LeverApiError when response.json() fails (invalid JSON)", async () => {
    // Simulate 200 OK with a body that fails to parse (truncated response,
    // proxy interstitial, HTML error page, etc.). The json() promise rejects
    // with a SyntaxError, which we catch and rethrow as retryable because
    // truncation and proxy issues are transient.
    const badJsonResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    } as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(badJsonResponse);

    await expect(fetchLeverJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "LeverApiError",
      retryable: true,
    });
  });
});
