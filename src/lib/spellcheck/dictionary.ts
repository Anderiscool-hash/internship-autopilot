/**
 * The vocabulary the spell checker is allowed to recognise.
 *
 * This list is DELIBERATELY NARROW. It is not an English dictionary and it is
 * not trying to become one. It holds four kinds of word:
 *
 *   1. the tools and technologies a CS / cybersecurity student actually lists,
 *   2. the security and computing vocabulary those students write in prose,
 *   3. the academic words that show up in a degree or school field,
 *   4. the ordinary words that show up in application answers and addresses.
 *
 * Why narrow on purpose: this dictionary is the *only* source of suggestions.
 * A big general word list would mean a typo in "Kubernetes" could be matched
 * against some obscure real word instead, and - worse - real words this app
 * has never heard of would get "corrected" towards something wrong. A short
 * list produces fewer suggestions, and the ones it produces are far more
 * likely to be right. Silence is the safe failure mode here (see check.ts).
 *
 * JUDGMENT CALL - nothing shorter than four letters goes in this file. The
 * checker never examines a word under four letters (too many short words are
 * one edit apart from each other to guess safely), so a three-letter entry
 * could never be *checked*, but it could still be *suggested* - "Git" offered
 * as the fix for "gut". Keeping them out entirely removes that whole class of
 * bad suggestion. Anything shorter than four letters listed below is dropped
 * silently by `buildCanonical`.
 *
 * To add a word: put it in the right group below, spelled the way it should
 * appear to an employer (so "PostgreSQL", not "postgresql"). The lookup is
 * case-insensitive; the casing you type is what a suggestion will restore.
 */

/** Shortest entry this dictionary will accept. See the header for why. */
export const MIN_DICTIONARY_WORD_LENGTH = 4;

// ---------------------------------------------------------------------------
// 1. Technologies and tools
// ---------------------------------------------------------------------------
// Cased the way the vendor cases them, because that casing is the whole point
// of the CANONICAL map: "postgresql" on a resume is a small, visible mistake.
const TECHNOLOGY: readonly string[] = [
  // languages and runtimes
  "TypeScript", "JavaScript", "Python", "Java", "Kotlin", "Swift", "Rust",
  "Golang", "Ruby", "Scala", "Perl", "Haskell", "Elixir", "Solidity",
  "Assembly", "Verilog", "MATLAB", "Bash", "PowerShell", "Node", "Node.js",
  "Deno", "Dart",

  // web and app frameworks
  "React", "Angular", "Svelte", "Next", "Express", "Django", "Flask",
  "Spring", "Rails", "Laravel", "Tailwind", "Bootstrap", "GraphQL", "Vite",

  // data stores and data tooling
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Prisma", "Kafka",
  "Hadoop", "Spark", "Pandas", "NumPy", "TensorFlow", "PyTorch", "Jupyter",
  "Elasticsearch", "Snowflake",

  // infrastructure, cloud and DevOps
  "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "Helm",
  "Vagrant", "VirtualBox", "VMware", "Nginx", "Apache", "Azure", "Cloudflare",
  "Firebase", "Supabase", "Vercel", "Netlify", "Heroku", "Grafana",
  "Prometheus", "Kibana", "Logstash", "Linux", "Ubuntu", "Debian", "Fedora",
  "CentOS", "Windows", "Unix", "macOS",

  // security tooling - the shortlist a student is likely to have touched
  "Wireshark", "Splunk", "Nmap", "Metasploit", "Nessus", "Snort", "Suricata",
  "Zeek", "Burp", "Nikto", "Hydra", "Hashcat", "Autopsy", "Volatility",
  "Ghidra", "Wazuh", "OpenVAS", "Shodan", "Censys", "Qualys", "Tenable",
  "CrowdStrike", "SentinelOne", "OpenSSL", "Bitwarden", "Kali", "Parrot",
  "Okta", "YubiKey",

  // everyday developer tools and the sites a student links to
  "GitHub", "GitLab", "Bitbucket", "Jira", "Confluence", "Figma", "Postman",
  "Slack", "Notion", "Excel", "Word", "PowerPoint", "Outlook", "Google",
  "Microsoft", "Oracle", "Salesforce", "Visual", "Studio", "Code", "Xcode",
  "IntelliJ", "Eclipse", "Vitest", "Jest", "Playwright", "Selenium",

  // job boards and applicant tracking systems, so their names are not "typos"
  "LinkedIn", "Handshake", "Indeed", "Glassdoor", "Greenhouse", "Workday",
  "Lever", "Ashby", "Taleo", "iCIMS", "SmartRecruiters",
];

// ---------------------------------------------------------------------------
// 2. Security and computer-science vocabulary
// ---------------------------------------------------------------------------
// Prose words, not product names, so these are lowercase. The checker also
// understands ordinary endings (plurals, -ed, -ing), so "vulnerabilities" is
// covered by "vulnerability" and does not need its own entry.
const SECURITY_AND_CS: readonly string[] = [
  "cyber", "cybersecurity", "security", "secure", "insecure", "vulnerability",
  "penetration", "exploit", "exploitation", "payload", "malware", "ransomware",
  "spyware", "phishing", "spoofing", "sniffing", "backdoor", "rootkit",
  "botnet", "keylogger", "breach", "attacker", "adversary", "threat",
  "intrusion", "detection", "prevention", "mitigation", "remediation",
  "hardening", "patching", "forensics", "forensic", "incident", "response",
  "compliance", "governance", "audit", "auditing", "policy", "risk",
  "assessment", "framework", "control", "baseline", "telemetry", "anomaly",
  "triage", "playbook", "endpoint", "perimeter", "sandbox", "honeypot",

  "cryptography", "cryptographic", "encryption", "decryption", "cipher",
  "hashing", "salting", "certificate", "signature", "keypair", "token",
  "authentication", "authorization", "credential", "password", "passphrase",
  "session", "identity", "privilege", "escalation", "permission",
  "confidentiality", "integrity", "availability", "privacy",

  "firewall", "network", "networking", "subnet", "packet", "protocol",
  "router", "switch", "gateway", "proxy", "tunnel", "server", "client",
  "socket", "traffic", "bandwidth", "latency", "throughput", "wireless",
  "ethernet", "address", "domain", "hostname", "routing",

  "algorithm", "database", "infrastructure", "architecture", "virtualization",
  "container", "orchestration", "automation", "scripting", "debugging",
  "compiler", "runtime", "kernel", "process", "thread", "memory", "storage",
  "backup", "recovery", "redundancy", "cluster", "deployment", "pipeline",
  "repository", "version", "branch", "commit", "merge", "release",
  "frontend", "backend", "fullstack", "software", "hardware", "system",
  "application", "interface", "library", "function", "variable", "structure",
  "recursion", "pointer", "binary", "hexadecimal", "integer", "string",
  "boolean", "syntax", "semantics", "query", "schema", "index", "migration",
  "transaction", "concurrency", "scalability", "reliability", "performance",
  "testing", "monitoring", "logging", "dashboard", "alerting", "cloud",
  "computing", "machine", "learning", "analysis", "analytics", "operating",
];

// ---------------------------------------------------------------------------
// 3. Degrees, schools and academic words
// ---------------------------------------------------------------------------
const ACADEMIC: readonly string[] = [
  "bachelor", "bachelors", "master", "masters", "associate", "associates",
  "doctorate", "degree", "diploma", "certificate", "certification",
  "computer", "science", "engineering", "engineer", "technology",
  "information", "mathematics", "statistics", "physics", "chemistry",
  "biology", "economics", "business", "management", "discipline", "major",
  "minor", "concentration", "curriculum", "coursework", "semester",
  "quarter", "credit", "transcript", "graduation", "graduate", "graduated",
  "undergraduate", "postgraduate", "freshman", "sophomore", "junior",
  "senior", "student", "university", "college", "school", "academic",
  "cumulative", "honors", "scholarship", "capstone", "thesis", "research",
  "laboratory", "lecture", "tutor", "tutoring", "teaching", "assistant",
  "enrolled", "enrollment", "expected", "anticipated", "internship",
  "intern", "cooperative", "apprenticeship", "fellowship",
];

// ---------------------------------------------------------------------------
// 4. Ordinary words: application prose, form answers, and addresses
// ---------------------------------------------------------------------------
// The typo that started this file - "108 autum ave" - lives in this group.
// Address words and the classic misspelled English words are here because
// they are what the candidate's stored profile is actually made of.
const EVERYDAY: readonly string[] = [
  // addresses and places
  "autumn", "avenue", "street", "boulevard", "drive", "road", "lane",
  "court", "circle", "place", "terrace", "parkway", "highway", "apartment",
  "suite", "unit", "floor", "north", "south", "east", "west", "city",
  "state", "county", "country", "united", "states", "district", "village",
  "township", "region",

  // Place and institution words that the live report proved it needed. Every
  // one of these was reported as a typo of something else before it was
  // listed: "York" was "corrected" to "Work" five times over, and "Criminal"
  // (as in John Jay College of Criminal Justice) to "Critical". Place names
  // are endless and this list will never cover them all - it covers the ones
  // in this candidate's actual profile, which is the whole point of a
  // curated dictionary.
  "york", "jersey", "boston", "criminal", "justice", "college", "campus",

  // months (dates that still have their digits attached are skipped entirely)
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december",

  // the words an application form asks about
  "applicant", "application", "applying", "employer", "employment",
  "candidate", "resume", "reference", "referral", "salary", "compensation",
  "schedule", "flexible", "remote", "hybrid", "onsite", "relocate",
  "relocation", "sponsorship", "sponsor", "authorized", "eligible",
  "eligibility", "citizen", "citizenship", "veteran", "disability",
  "gender", "ethnicity", "voluntary", "decline", "question", "answer",
  "prefer", "preference", "preferred", "location", "locations",
  "position", "opening", "opportunity", "available", "availability",
  "contact", "email", "phone", "mobile", "portfolio", "website", "profile",

  // the words a candidate writes about themselves
  "experience", "experienced", "responsible", "responsibility", "achievement",
  "communication", "communicate", "collaborate", "collaboration",
  "professional", "immediately", "separate", "definitely", "receive",
  "believe", "necessary", "occurred", "recommend", "recommendation",
  "successful", "success", "interested", "interest", "summary", "objective",
  "leadership", "teamwork", "initiative", "motivated", "passionate",
  "detail", "oriented", "analytical", "problem", "solving", "critical",
  "thinking", "organized", "reliable", "punctual", "independent",
  "improve", "improvement", "develop", "development", "developed",
  "design", "designed", "implement", "implemented", "maintain", "maintained",
  "manage", "managed", "support", "supported", "assist", "assisted",
  "create", "created", "build", "built", "deploy", "deployed", "test",
  "tested", "document", "documented", "present", "presented", "train",
  "trained", "volunteer", "community", "project", "team", "member",
  "customer", "service", "sales", "inventory", "restocking", "seasonal",
  // "gain" earns its place the same way "york" did: without it, "gain real
  // world experience" was reported as a typo of "again", twice.
  "gain", "gained", "world", "proud", "mentorship", "growth",

  // plain connective English - kept small on purpose
  "about", "above", "after", "again", "against", "along", "also", "although",
  "always", "another", "because", "been", "before", "being", "between",
  "both", "could", "during", "each", "either", "every", "from", "further",
  "have", "having", "here", "however", "into", "more", "most", "much",
  "must", "over", "same", "should", "since", "some", "such", "than",
  "that", "their", "them", "then", "there", "these", "they", "this",
  "those", "through", "under", "until", "upon", "very", "were", "what",
  "when", "where", "which", "while", "with", "within", "without", "would",
  "your", "yours", "year", "years", "month", "week", "hour", "hours",
  "time", "work", "working", "role", "roles", "level", "entry", "part",
  "full",
];

/**
 * Fold every group into one lookup, keyed by the lowercase spelling.
 *
 * Words shorter than `MIN_DICTIONARY_WORD_LENGTH` are dropped (see header).
 * A duplicate keeps whichever casing was listed first, so the groups above
 * can repeat a word without the later group silently changing its casing.
 */
function buildCanonical(groups: readonly (readonly string[])[]): Map<string, string> {
  const canonical = new Map<string, string>();

  for (const group of groups) {
    for (const word of group) {
      const lower = word.toLowerCase();
      if (lower.length < MIN_DICTIONARY_WORD_LENGTH) continue;
      if (canonical.has(lower)) continue;
      canonical.set(lower, word);
    }
  }
  return canonical;
}

/**
 * Lowercase word -> the spelling that should appear on an application.
 *
 * "kubernetes" -> "Kubernetes", "postgresql" -> "PostgreSQL". Ordinary prose
 * words map to themselves in lowercase; the checker restores sentence casing
 * for those (see `applyCasing` in check.ts).
 */
export const CANONICAL: ReadonlyMap<string, string> = buildCanonical([
  TECHNOLOGY,
  SECURITY_AND_CS,
  ACADEMIC,
  EVERYDAY,
]);

/** Every word this checker knows, lowercase. The only source of suggestions. */
export const DICTIONARY: ReadonlySet<string> = new Set(CANONICAL.keys());

/** The properly-cased spelling of a known word, or the word unchanged. */
export function canonicalSpelling(lowercaseWord: string): string {
  return CANONICAL.get(lowercaseWord) ?? lowercaseWord;
}
