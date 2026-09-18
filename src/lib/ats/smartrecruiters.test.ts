/**
 * Tests for the SmartRecruiters job-board client.
 *
 * We never hit the real network here - `globalThis.fetch` is replaced with a
 * fake for every test so these run instantly and don't depend on
 * SmartRecruiters being up.
 *
 * SmartRecruiters needs a slightly richer fake than Greenhouse or Lever do,
 * because this client makes two KINDS of request: one paged list walk, then
 * one detail request per student-flagged posting. `mockBoard` below routes by
 * URL so a test can describe a board declaratively and then assert on which
 * requests were actually made - which is the whole point of several of these
 * tests, since "did we avoid fetching 4,000 descriptions?" is a question about
 * call counts, not about return values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSmartRecruitersJobs,
  SmartRecruitersApiError,
  MAX_DETAIL_FETCHES,
} from "./smartrecruiters";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** One list-endpoint posting, with the fields this client actually reads. */
interface ListItem {
  id: string;
  name: string;
  releasedDate?: string | null;
  location?: Record<string, unknown> | null;
  experienceLevel?: { id: string; label: string } | null;
  typeOfEmployment?: { id: string; label: string } | null;
}

function listItem(overrides: Partial<ListItem> & { id: string }): ListItem {
  return {
    name: `Posting ${overrides.id}`,
    releasedDate: "2026-09-18T19:35:20.767Z",
    location: {
      city: "Pittsburgh",
      region: "PA",
      country: "us",
      fullLocation: "Pittsburgh, PA, United States",
      remote: false,
      hybrid: false,
    },
    experienceLevel: { id: "internship", label: "Internship" },
    typeOfEmployment: { id: "intern", label: "Intern" },
    ...overrides,
  };
}

/** The detail record the client hydrates a flagged posting with. */
function detailFor(item: ListItem, overrides: Record<string, unknown> = {}) {
  return {
    id: item.id,
    name: item.name,
    postingUrl: `https://jobs.smartrecruiters.com/BoschGroup/${item.id}-posting`,
    applyUrl: `https://jobs.smartrecruiters.com/BoschGroup/${item.id}-posting?oga=true`,
    active: true,
    releasedDate: item.releasedDate,
    location: item.location,
    experienceLevel: item.experienceLevel,
    typeOfEmployment: item.typeOfEmployment,
    jobAd: {
      sections: {
        companyDescription: { title: "Company Description", text: "<p>We Are Bosch.</p>" },
        jobDescription: { title: "Job Description", text: "<p>Build robots.</p>" },
        qualifications: {
          title: "Qualifications",
          text: "<ul><li>Pursuing a Masters degree</li></ul>",
        },
        additionalInformation: { title: "Additional Information", text: "<p>EOE.</p>" },
      },
    },
    ...overrides,
  };
}

/**
 * Installs a fake board: `items` are served through the paged list endpoint
 * (100 per page, exactly like the real API) and `details` answers the
 * per-posting detail endpoint, keyed by posting id.
 *
 * `details` values may be a plain object (served as 200) or a `Response`, so a
 * test can make one specific posting 404 or 500 while the rest succeed.
 */
function mockBoard(options: {
  items: ListItem[];
  details?: Record<string, unknown>;
  totalFound?: number;
}) {
  const { items, details = {}, totalFound = options.items.length } = options;

  vi.mocked(globalThis.fetch).mockImplementation(async (input: unknown) => {
    const url = String(input);
    const detailMatch = /\/postings\/([^?]+)$/.exec(url);

    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]!);
      const entry = details[id];
      if (entry === undefined) {
        return jsonResponse({ message: "not found" }, 404);
      }
      // Anything already shaped like a Response (a deliberate error case) is
      // passed straight through.
      if (typeof entry === "object" && entry !== null && "ok" in entry) {
        return entry as Response;
      }
      return jsonResponse(entry);
    }

    const offset = Number(/[?&]offset=(\d+)/.exec(url)?.[1] ?? "0");
    return jsonResponse({
      offset,
      limit: 100,
      totalFound,
      content: items.slice(offset, offset + 100),
    });
  });
}

/** How many of the recorded fetch calls hit the per-posting detail endpoint. */
function detailCallCount(): number {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter((call) => /\/postings\/[^?]+$/.test(String(call[0]))).length;
}

describe("fetchSmartRecruitersJobs", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps a list entry plus its detail record into a CanonicalJob", async () => {
    // The real Bosch posting used to verify this client against the live API.
    const item = listItem({
      id: "744000150446259",
      // Note the trailing space - SmartRecruiters really does serve it.
      name: "Robot Learning Engineering Intern ",
    });
    mockBoard({ items: [item], details: { [item.id]: detailFor(item) } });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.companyName).toBe("Bosch Group");
    expect(job.source).toBe("SmartRecruiters");
    expect(job.atsType).toBe("smartrecruiters");
    expect(job.sourceJobId).toBe("744000150446259");
    expect(job.title).toBe("Robot Learning Engineering Intern");
    expect(job.location).toBe("Pittsburgh, PA, United States");
    expect(job.remoteType).toBe("onsite");
    expect(job.employmentType).toBe("Intern");
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.currency).toBeNull();
    expect(job.canonicalUrl).toBe(
      "https://jobs.smartrecruiters.com/BoschGroup/744000150446259-posting",
    );
    expect(job.sourcePostedAt).toEqual(new Date("2026-09-18T19:35:20.767Z"));

    // All four job-ad sections should be present, stripped of HTML, with the
    // role-specific text ahead of the company boilerplate.
    expect(job.description).not.toContain("<");
    expect(job.description).toContain("Build robots.");
    expect(job.description).toContain("Qualifications");
    expect(job.description).toContain("- Pursuing a Masters degree");
    expect(job.description).toContain("We Are Bosch.");
    expect(job.description.indexOf("Build robots.")).toBeLessThan(
      job.description.indexOf("We Are Bosch."),
    );
  });

  it("walks every page of the list endpoint", async () => {
    // 250 postings = three pages at limit=100. Only two are flagged as student
    // roles, and one of them sits on the last page, so a client that stopped
    // after the first page would miss it entirely.
    const items: ListItem[] = [];
    for (let i = 0; i < 250; i += 1) {
      items.push(
        listItem({
          id: `job-${i}`,
          experienceLevel: { id: "associate", label: "Associate" },
          typeOfEmployment: { id: "permanent", label: "Permanent" },
        }),
      );
    }
    items[5] = listItem({ id: "intern-early", name: "Software Engineering Intern" });
    items[248] = listItem({ id: "intern-late", name: "Data Science Intern" });

    mockBoard({
      items,
      details: {
        "intern-early": detailFor(items[5]!),
        "intern-late": detailFor(items[248]!),
      },
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["intern-early", "intern-late"]);

    const listCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map((call) => String(call[0]))
      .filter((url) => url.includes("offset="));
    expect(listCalls).toHaveLength(3);
    expect(listCalls[0]).toContain("offset=0");
    expect(listCalls[1]).toContain("offset=100");
    expect(listCalls[2]).toContain("offset=200");
  });

  it("does not spend a detail request on postings SmartRecruiters did not flag as student roles", async () => {
    // This is the whole economic argument for the client's design: Bosch has
    // 4,822 postings and hydrating all of them would be one request each.
    const items = [
      listItem({ id: "keep-1", name: "Robotics Intern" }),
      listItem({
        id: "skip-senior",
        experienceLevel: { id: "mid_senior_level", label: "Mid-Senior Level" },
        typeOfEmployment: { id: "permanent", label: "Permanent" },
      }),
      listItem({
        id: "skip-director",
        experienceLevel: { id: "director", label: "Director" },
        typeOfEmployment: { id: "permanent", label: "Permanent" },
      }),
      listItem({
        id: "keep-entry",
        name: "New Grad Engineer",
        experienceLevel: { id: "entry_level", label: "Entry Level" },
        typeOfEmployment: { id: "permanent", label: "Permanent" },
      }),
      listItem({
        // Flagged by employment type alone - the experience level says nothing.
        id: "keep-by-employment-type",
        name: "Summer Student",
        experienceLevel: { id: "not_applicable", label: "Not Applicable" },
        typeOfEmployment: { id: "intern", label: "Intern" },
      }),
    ];

    mockBoard({
      items,
      details: Object.fromEntries(
        items.map((item) => [item.id, detailFor(item)] as const),
      ),
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs.map((job) => job.sourceJobId)).toEqual([
      "keep-1",
      "keep-entry",
      "keep-by-employment-type",
    ]);
    // Three flagged postings, three detail requests - the two senior postings
    // cost nothing.
    expect(detailCallCount()).toBe(3);
  });

  it("returns only hydrated jobs, so an empty description can only mean the employer wrote none", async () => {
    // The correctness point this client is built around. `extractRequirements`
    // reads an empty description as "no requirements stated", which the
    // eligibility engine reads as "nothing rules you out". CanonicalJob's
    // `description` is a non-nullable string and cannot say "not fetched", so
    // a posting we never hydrated must never reach the caller at all.
    const hydrated = listItem({ id: "hydrated", name: "Robotics Intern" });
    const senior = listItem({
      id: "never-fetched",
      experienceLevel: { id: "mid_senior_level", label: "Mid-Senior Level" },
      typeOfEmployment: { id: "permanent", label: "Permanent" },
    });
    // A genuinely empty job ad: the employer published the posting with no
    // section text at all. This one IS returned, with an empty description,
    // because that empty string is a true report of what they wrote.
    const emptyAd = listItem({ id: "empty-ad", name: "Marketing Intern" });

    mockBoard({
      items: [hydrated, senior, emptyAd],
      details: {
        hydrated: detailFor(hydrated),
        "empty-ad": detailFor(emptyAd, { jobAd: { sections: {} } }),
      },
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["hydrated", "empty-ad"]);
    // The un-hydrated posting is absent rather than present-with-"".
    expect(jobs.some((job) => job.sourceJobId === "never-fetched")).toBe(false);
    expect(jobs[0]!.description.length).toBeGreaterThan(0);
    expect(jobs[1]!.description).toBe("");
  });

  it("throws a non-retryable error rather than returning a truncated list when the hydration cap is exceeded", async () => {
    // A truncated list would be actively dangerous: the scanner's
    // `shouldTrustForRemoval` only distrusts a fetch of length zero, so any
    // shortened list makes it mark the missing-but-live jobs CLOSED.
    const items: ListItem[] = [];
    for (let i = 0; i < MAX_DETAIL_FETCHES + 1; i += 1) {
      items.push(listItem({ id: `intern-${i}` }));
    }
    mockBoard({ items });

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: false,
    });

    // The cap is checked before hydration starts, so an oversized board costs
    // one list walk and zero detail requests.
    expect(detailCallCount()).toBe(0);
  });

  it("maps remote and hybrid location flags to RemoteType", async () => {
    const remote = listItem({
      id: "remote-intern",
      location: { fullLocation: "Remote, US", remote: true, hybrid: false },
    });
    const hybrid = listItem({
      id: "hybrid-intern",
      location: { fullLocation: "Chicago, IL, United States", remote: false, hybrid: true },
    });
    const unknown = listItem({ id: "unknown-intern", location: null });

    mockBoard({
      items: [remote, hybrid, unknown],
      details: {
        "remote-intern": detailFor(remote),
        "hybrid-intern": detailFor(hybrid),
        "unknown-intern": detailFor(unknown),
      },
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs.map((job) => job.remoteType)).toEqual(["remote", "hybrid", "unknown"]);
    expect(jobs[2]!.location).toBeNull();
  });

  it("falls back to applyUrl, then to the derived posting URL, for canonicalUrl", async () => {
    const noPosting = listItem({ id: "no-posting-url" });
    const noUrls = listItem({ id: "no-urls" });

    mockBoard({
      items: [noPosting, noUrls],
      details: {
        "no-posting-url": detailFor(noPosting, { postingUrl: null }),
        "no-urls": detailFor(noUrls, { postingUrl: null, applyUrl: null }),
      },
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");

    expect(jobs[0]!.canonicalUrl).toBe(
      "https://jobs.smartrecruiters.com/BoschGroup/no-posting-url-posting?oga=true",
    );
    expect(jobs[1]!.canonicalUrl).toBe(
      "https://jobs.smartrecruiters.com/BoschGroup/no-urls",
    );
  });

  it("skips a posting that 404s or reports itself inactive between the list and detail calls", async () => {
    const present = listItem({ id: "still-there" });
    const gone = listItem({ id: "taken-down" });
    const inactive = listItem({ id: "now-inactive" });

    mockBoard({
      items: [present, gone, inactive],
      details: {
        // "taken-down" is deliberately absent, so mockBoard answers 404.
        "still-there": detailFor(present),
        "now-inactive": detailFor(inactive, { active: false }),
      },
    });

    const jobs = await fetchSmartRecruitersJobs("BoschGroup", "Bosch Group");
    expect(jobs.map((job) => job.sourceJobId)).toEqual(["still-there"]);
  });

  it("fails the whole board when a detail request 5xxs, rather than silently returning fewer jobs", async () => {
    // Swallowing this would shorten the list, and a shortened list is exactly
    // what makes the scanner close live jobs.
    const ok = listItem({ id: "fine" });
    const broken = listItem({ id: "server-error" });

    mockBoard({
      items: [ok, broken],
      details: {
        fine: detailFor(ok),
        "server-error": jsonResponse({}, 503),
      },
    });

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: true,
      statusCode: 503,
    });
  });

  it("throws a non-retryable error for an empty board, because that is how a wrong identifier looks", async () => {
    // SmartRecruiters answers 200 with totalFound:0 for a company that does
    // not exist - verified against the live API. Returning [] here would let a
    // typo'd identifier into the registry looking like a quiet board.
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ offset: 0, limit: 100, totalFound: 0, content: [] }),
    );

    await expect(
      fetchSmartRecruitersJobs("definitely-not-a-real-company", "Ghost Co"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: false,
    });
  });

  it("returns an empty array for a real board with no student roles", async () => {
    // Distinct from the case above: the board demonstrably exists, it just has
    // nothing for a student. That is an answer, not an error.
    mockBoard({
      items: [
        listItem({
          id: "senior-only",
          experienceLevel: { id: "executive", label: "Executive" },
          typeOfEmployment: { id: "permanent", label: "Permanent" },
        }),
      ],
    });

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).resolves.toEqual([]);
    expect(detailCallCount()).toBe(0);
  });

  it("throws a non-retryable error on 404 (company gone)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 404));

    await expect(
      fetchSmartRecruitersJobs("ghost-co", "Ghost Co"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: false,
      statusCode: 404,
    });
  });

  it("throws a retryable error on 429 (rate limited)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 429));

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: true,
      statusCode: 429,
    });
  });

  it("throws a retryable error on 5xx (server error)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 502));

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: true,
      statusCode: 502,
    });
  });

  it("throws a non-retryable error when the list response shape is wrong", async () => {
    // A bare array is Lever's shape, not SmartRecruiters'. This is not "zero
    // jobs", it is a response we do not understand, and retrying cannot fix it.
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse([]));

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: false,
    });
  });

  it("throws a non-retryable error when a detail response shape is wrong", async () => {
    const item = listItem({ id: "weird-detail" });
    mockBoard({
      items: [item],
      details: { "weird-detail": { unexpected: "shape" } },
    });

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toThrow(SmartRecruitersApiError);
  });

  it("throws a retryable error when response.json() fails (invalid JSON)", async () => {
    // 200 OK with a body that fails to parse - a truncated response, a proxy
    // interstitial, an HTML error page. Transient, so retryable.
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    } as Response);

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: true,
    });
  });

  it("throws a retryable error when the network call itself fails", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      fetchSmartRecruitersJobs("BoschGroup", "Bosch Group"),
    ).rejects.toMatchObject({
      name: "SmartRecruitersApiError",
      retryable: true,
    });
  });
});
