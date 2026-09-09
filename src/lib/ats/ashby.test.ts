/**
 * Tests for the Ashby job-board client.
 *
 * We never hit the real network here - `globalThis.fetch` is replaced with
 * a fake for every test so these run instantly and don't depend on Ashby
 * being up. Each test feeds the parser a small, realistic fixture (or a
 * deliberately broken one) and checks what comes out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAshbyJobs, AshbyApiError } from "./ashby";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchAshbyJobs", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a valid Ashby response into CanonicalJob objects, including compensation", async () => {
    const fixture = {
      organizationName: "Acme",
      jobs: [
        {
          id: "job-001",
          title: "Software Engineering Intern",
          location: "New York, NY",
          isRemote: false,
          employmentType: "Intern",
          descriptionHtml: "<p>Ship features.</p><ul><li>Code review</li></ul>",
          publishedAt: "2024-03-01T12:00:00.000Z",
          jobUrl: "https://jobs.ashbyhq.com/acme/job-001",
          applyUrl: "https://jobs.ashbyhq.com/acme/job-001/apply",
          compensation: {
            summaryComponents: [
              { minValue: 40, maxValue: 55, currencyCode: "USD" },
            ],
          },
        },
      ],
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchAshbyJobs("acme", "Acme Corp");

    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.companyName).toBe("Acme Corp");
    expect(job.source).toBe("Ashby");
    expect(job.atsType).toBe("ashby");
    expect(job.sourceJobId).toBe("job-001");
    expect(job.title).toBe("Software Engineering Intern");
    expect(job.location).toBe("New York, NY");
    expect(job.remoteType).toBe("unknown");
    expect(job.employmentType).toBe("Intern");
    expect(job.canonicalUrl).toBe("https://jobs.ashbyhq.com/acme/job-001");
    expect(job.salaryMin).toBe(40);
    expect(job.salaryMax).toBe(55);
    expect(job.currency).toBe("USD");
    expect(job.sourcePostedAt).toEqual(new Date("2024-03-01T12:00:00.000Z"));

    // HTML should be stripped into plain, readable text.
    expect(job.description).not.toContain("<");
    expect(job.description).toContain("Ship features.");
    expect(job.description).toContain("- Code review");
  });

  it("marks isRemote:true jobs as remote and jobs without compensation data as null salary", async () => {
    const fixture = {
      jobs: [
        {
          id: "job-002",
          title: "Marketing Intern",
          location: "Remote",
          isRemote: true,
          employmentType: "Intern",
          descriptionHtml: "<p>Grow the brand.</p>",
          jobUrl: "https://jobs.ashbyhq.com/acme/job-002",
          compensation: null,
        },
      ],
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchAshbyJobs("acme", "Acme Corp");
    expect(jobs[0]!.remoteType).toBe("remote");
    expect(jobs[0]!.salaryMin).toBeNull();
    expect(jobs[0]!.salaryMax).toBeNull();
    expect(jobs[0]!.currency).toBeNull();
    expect(jobs[0]!.sourcePostedAt).toBeNull();
  });

  it("throws AshbyApiError instead of returning an empty array when the response shape is wrong", async () => {
    // Missing the required "jobs" array entirely - this is not "zero jobs",
    // it's a broken/unexpected response and must not look like a quiet board.
    const malformed = { organizationName: "Acme" };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(malformed));

    await expect(fetchAshbyJobs("acme", "Acme Corp")).rejects.toThrow(AshbyApiError);
  });

  it("throws a non-retryable AshbyApiError on 404 (board gone)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 404));

    await expect(fetchAshbyJobs("ghost-co", "Ghost Co")).rejects.toMatchObject({
      name: "AshbyApiError",
      retryable: false,
      statusCode: 404,
    });
  });

  it("throws a retryable AshbyApiError on 429 (rate limited)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 429));

    await expect(fetchAshbyJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "AshbyApiError",
      retryable: true,
      statusCode: 429,
    });
  });

  it("throws a retryable AshbyApiError on 5xx (server error)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 500));

    await expect(fetchAshbyJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "AshbyApiError",
      retryable: true,
      statusCode: 500,
    });
  });

  it("throws a retryable AshbyApiError when response.json() fails (invalid JSON)", async () => {
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

    await expect(fetchAshbyJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "AshbyApiError",
      retryable: true,
    });
  });
});
