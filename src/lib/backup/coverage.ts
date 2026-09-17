// ============================================================================
// What a backup is required to contain — and a guard that says so out loud.
//
// The export script names its tables by hand. That is fine for reading, but a
// hand-written list has no way of noticing the day someone adds a model to
// schema.prisma: the new table simply never appears in a backup, and the
// export's own summary can't report a gap it doesn't know about. That is how
// ShadowRun (the entire human-verified evidence base behind the trust ladder),
// CandidateDocument and SubmissionAttempt went missing from every backup taken
// before this file existed — silently, for as long as nobody restored one.
//
// So the list stops being incidental and becomes a declaration: every model in
// the schema is either exported or deliberately excluded with a stated reason,
// and anything else stops the export. A gap found at export time costs a
// one-line edit; the same gap found at restore time costs the data.
// ============================================================================

/**
 * Prisma model name for every table a backup carries, keyed by the field name
 * it occupies in the export file.
 *
 * Order is the order rows must be written and replayed — parents before the
 * rows that point at them — because `import-data.ts` walks this same sequence
 * and a create fails outright if its foreign key isn't there yet.
 */
export const BACKUP_TABLES: Readonly<Record<string, string>> = {
  // Companies own jobs; candidates own nearly everything else.
  companies: "Company",
  jobs: "Job",
  candidates: "Candidate",
  candidateDocuments: "CandidateDocument",
  workExperiences: "WorkExperience",
  projects: "Project",
  education: "Education",
  truthFacts: "TruthFact",
  candidatePreferences: "CandidatePreferences",
  answerBankEntries: "AnswerBankEntry",
  applications: "Application",
  // Shadow runs reference a job and a candidate; submission attempts also
  // reference the application they were an attempt at.
  shadowRuns: "ShadowRun",
  submissionAttempts: "SubmissionAttempt",
  eventLogs: "EventLog",
  aiSettings: "AiSettings",
};

/**
 * Models a backup deliberately leaves behind, and why.
 *
 * Membership here is a decision someone made, not an oversight — which is the
 * whole point of writing it down. Adding a model to this map is a claim that
 * losing those rows is acceptable; if that isn't true, it belongs in
 * BACKUP_TABLES instead.
 */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  ResumeImport:
    "Rows hold the full text of an uploaded resume and exist only to carry a " +
    "parse across one redirect. Once a profile has been saved from one, " +
    "nothing reads it again — there is no reason for that text to travel to " +
    "a server.",
};

/** The three ways the declaration above can stop matching reality. */
export interface CoverageGaps {
  /** In the schema, but neither exported nor excluded — the silent-loss case. */
  unexported: string[];
  /** Declared in BACKUP_TABLES, but absent from what the export collected. */
  uncollected: string[];
  /** Declared in BACKUP_TABLES or excluded, but no longer in the schema. */
  stale: string[];
}

function isExcluded(modelName: string): boolean {
  // hasOwn, not `in`: a model called "constructor" or "toString" would
  // otherwise inherit an exclusion nobody wrote.
  return Object.hasOwn(EXCLUDED_MODELS, modelName);
}

/**
 * Compare the declaration against the live schema and against what an export
 * actually produced.
 *
 * `schemaModels` is `Prisma.dmmf.datamodel.models` in real use; it is typed
 * structurally so a test can hand over a two-model schema without building a
 * whole DMMF document.
 */
export function findCoverageGaps(input: {
  schemaModels: readonly { readonly name: string }[];
  collectedKeys: readonly string[];
}): CoverageGaps {
  const exported = new Set(Object.values(BACKUP_TABLES));
  const inSchema = new Set(input.schemaModels.map((model) => model.name));
  const collected = new Set(input.collectedKeys);

  return {
    unexported: input.schemaModels
      .map((model) => model.name)
      .filter((name) => !exported.has(name) && !isExcluded(name)),
    uncollected: Object.keys(BACKUP_TABLES).filter(
      (field) => !collected.has(field),
    ),
    stale: [...exported, ...Object.keys(EXCLUDED_MODELS)].filter(
      (name) => !inSchema.has(name),
    ),
  };
}

/** True when nothing drifted — kept separate so the message code stays flat. */
function isClean(gaps: CoverageGaps): boolean {
  return (
    gaps.unexported.length === 0 &&
    gaps.uncollected.length === 0 &&
    gaps.stale.length === 0
  );
}

/**
 * Throw unless every model in the schema is accounted for.
 *
 * Deliberately a throw and not a warning. A warning on a backup is read once,
 * at a moment when the backup appears to have succeeded; the cost of ignoring
 * it only arrives during a restore, when the rows are already gone. Refusing
 * to write a file that is quietly incomplete is the cheaper failure.
 */
export function assertExportCoverage(input: {
  schemaModels: readonly { readonly name: string }[];
  collectedKeys: readonly string[];
}): void {
  const gaps = findCoverageGaps(input);
  if (isClean(gaps)) return;

  const lines = ["Backup coverage check failed — nothing was written.", ""];

  if (gaps.unexported.length > 0) {
    lines.push(
      `These models are in prisma/schema.prisma but would not be backed up: ${gaps.unexported.join(", ")}.`,
      "Add each one to collect() in scripts/export-data.ts and to BACKUP_TABLES",
      "and the load() sequence in scripts/import-data.ts — or, if its rows really",
      "are disposable, add it to EXCLUDED_MODELS with the reason.",
      "",
    );
  }

  if (gaps.uncollected.length > 0) {
    lines.push(
      `These tables are declared in BACKUP_TABLES but collect() returned nothing for them: ${gaps.uncollected.join(", ")}.`,
      "The export would have written a file that silently omits them.",
      "",
    );
  }

  if (gaps.stale.length > 0) {
    lines.push(
      `These names are declared here but no longer exist in the schema: ${gaps.stale.join(", ")}.`,
      "A rename leaves the old name behind and hides the new one — update both.",
      "",
    );
  }

  throw new Error(lines.join("\n"));
}
