/**
 * Tests for the Greenhouse job-board client.
 *
 * We never hit the real network here - `globalThis.fetch` is replaced with
 * a fake for every test so these run instantly and don't depend on
 * Greenhouse being up. Each test feeds the parser a small, realistic
 * fixture (or a deliberately broken one) and checks what comes out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGreenhouseJobs, GreenhouseApiError } from "./greenhouse";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchGreenhouseJobs", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a valid Greenhouse response into CanonicalJob objects", async () => {
    const fixture = {
      jobs: [
        {
          id: 12345,
          title: "Software Engineering Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/12345",
          location: { name: "Remote - US" },
          content: "<p>Build things.</p><ul><li>Write code</li><li>Ship it</li></ul>",
          updated_at: "2024-02-01T00:00:00-05:00",
          first_published: "2024-01-15T00:00:00-05:00",
        },
      ],
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchGreenhouseJobs("acme", "Acme Corp");

    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.companyName).toBe("Acme Corp");
    expect(job.source).toBe("Greenhouse");
    expect(job.atsType).toBe("greenhouse");
    expect(job.sourceJobId).toBe("12345");
    expect(job.title).toBe("Software Engineering Intern");
    expect(job.location).toBe("Remote - US");
    expect(job.remoteType).toBe("remote");
    expect(job.canonicalUrl).toBe("https://boards.greenhouse.io/acme/jobs/12345");
    expect(job.employmentType).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.currency).toBeNull();
    expect(job.sourcePostedAt).toEqual(new Date("2024-01-15T00:00:00-05:00"));

    // HTML should be stripped into plain, readable text.
    expect(job.description).not.toContain("<");
    expect(job.description).toContain("Build things.");
    expect(job.description).toContain("- Write code");
    expect(job.description).toContain("- Ship it");
  });

  it("classifies a job with no remote/hybrid keyword as unknown remote type", async () => {
    const fixture = {
      jobs: [
        {
          id: 1,
          title: "Data Analyst Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "New York, NY" },
          content: "<p>Analyze data.</p>",
        },
      ],
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(fixture));

    const jobs = await fetchGreenhouseJobs("acme", "Acme Corp");
    expect(jobs[0]!.remoteType).toBe("unknown");
    expect(jobs[0]!.sourcePostedAt).toBeNull();
  });

  it("throws GreenhouseApiError instead of returning an empty array when the response shape is wrong", async () => {
    // Missing the required "jobs" array entirely - this is not "zero jobs",
    // it's a broken/unexpected response and must not look like a quiet board.
    const malformed = { error: "not found" };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(malformed));

    await expect(fetchGreenhouseJobs("acme", "Acme Corp")).rejects.toThrow(GreenhouseApiError);
  });

  it("throws a non-retryable GreenhouseApiError on 404 (board gone)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 404));

    await expect(fetchGreenhouseJobs("ghost-co", "Ghost Co")).rejects.toMatchObject({
      name: "GreenhouseApiError",
      retryable: false,
      statusCode: 404,
    });
  });

  it("throws a retryable GreenhouseApiError on 429 (rate limited)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 429));

    await expect(fetchGreenhouseJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "GreenhouseApiError",
      retryable: true,
      statusCode: 429,
    });
  });

  it("throws a retryable GreenhouseApiError on 500 (server error)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 503));

    await expect(fetchGreenhouseJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "GreenhouseApiError",
      retryable: true,
      statusCode: 503,
    });
  });

  it("throws a retryable GreenhouseApiError when response.json() fails (invalid JSON)", async () => {
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

    await expect(fetchGreenhouseJobs("acme", "Acme Corp")).rejects.toMatchObject({
      name: "GreenhouseApiError",
      retryable: true,
    });
  });
});
