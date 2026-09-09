# Internship Autopilot — Project Plan

## Overview

The goal is to build a full internship operating system that continuously monitors company career sites and ATS platforms, identifies student/internship roles, checks them against a user's requirements, prepares tailored application materials, auto-applies when confidence is high, and tracks outcomes automatically.

The platform should support:

- Continuous internship scraping
- Company + ATS registry
- Job normalization and deduplication
- Hard eligibility filtering
- AI job-fit scoring
- AI resume builder
- ATS-friendly resume tailoring
- Cover letter generation
- Application answer bank
- Recruiter/contact finder
- Internship alerts
- Application tracking
- Gmail-based application status detection
- Shadow Mode
- Trusted auto-apply
- AWS deployment
- Homelab development/testing
- Analytics and learning from application outcomes

---

# 1. Core Product Architecture

```text
                  COMPANY + ATS REGISTRY
                         │
              Thousands of monitored companies
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Greenhouse          Lever            Ashby
        │                │                │
        ├──────── Workday / iCIMS / SmartRecruiters
        │
        └──────── Custom career pages
                         │
                         ▼
                 CONTINUOUS SCANNER
                         │
                         ▼
                  RAW JOB INGESTION
                         │
                         ▼
                NORMALIZE + DEDUPE
                         │
                         ▼
                STUDENT ROLE FILTER
                         │
                         ▼
                 ELIGIBILITY ENGINE
                         │
                  PASS          FAIL
                   │              │
                   ▼              └── Ignore
               MATCH ENGINE
                   │
            Match score 0–100
                   │
             ┌─────┴─────┐
             ▼           ▼
           Weak         Strong
                         │
                         ▼
                 APPLICATION PREP
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Resume Agent     Cover Letter      Answer Agent
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                APPLICATION PREFLIGHT
                         │
                         ▼
            APPLICATION CONFIDENCE
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
      AUTO APPLY       REVIEW           HOLD
         │
         ▼
    PLAYWRIGHT WORKER
         │
         ▼
    VERIFY SUBMISSION
         │
         ▼
    APPLICATION TRACKER
         │
       Gmail
         │
         ▼
 Rejection / Interview / Offer
```

---

# 2. Unified Candidate Profile

The user creates their profile once and the entire platform reuses it.

## Profile Data

- Name
- Email
- Phone
- Address
- School
- Degree
- Graduation date
- Work authorization
- Sponsorship needs
- Citizenship status if relevant
- Preferred locations
- Remote preference
- Minimum salary
- Desired roles
- Skills
- Certifications
- LinkedIn
- GitHub
- Portfolio
- Work experience
- Projects
- Education
- Reusable application answers

---

# 3. Truth Ledger

The AI should never invent qualifications.

Every important candidate fact should be stored as structured data.

Example:

```text
FACT-001
Company: Uniqlo
Position: Seasonal Sales Associate
Activity: Inventory and restocking

FACT-002
Project: Homelab
Technology: Proxmox

FACT-003
Project: Portfolio
Technology: Next.js
```

The AI may:

- Rephrase facts
- Combine facts
- Target job keywords
- Improve wording
- Shorten or expand bullets
- Quantify only when a real number exists

The AI may not:

- Invent jobs
- Invent certifications
- Invent skills
- Invent technologies
- Invent metrics
- Invent years of experience

---

# 4. Company + ATS Registry

The platform should maintain a growing registry of company career infrastructure.

## Company Schema

```text
Company
─────────────────────────
id
name
domain
careers_url
ats_type
ats_identifier
country
company_size
last_scan
last_change
scan_priority
poll_interval
failure_count
active
```

## Initial ATS Support

1. Greenhouse
2. Lever
3. Ashby
4. Workday
5. SmartRecruiters
6. iCIMS
7. Jobvite
8. Oracle
9. SAP SuccessFactors
10. Custom career sites

---

# 5. Continuous Job Discovery

The scraper should run 24/7.

## Adaptive Polling

```text
Priority companies       every ~5 minutes
Recently active boards   every ~10–15 minutes
Normal boards            every ~30 minutes
Dormant boards           every ~60 minutes
```

If a company becomes active, increase scan frequency.

If a source starts failing or rate-limiting:

```text
error
 ↓
backoff
 ↓
retry later
```

---

# 6. Job Discovery Sources

Primary sources:

- Employer ATS boards
- Employer career pages
- Public ATS job APIs
- Curated internship feeds
- Company watch lists

Curated feeds should only be used for discovery.

The platform should always resolve back to the original employer job posting before scoring or applying.

Avoid building automated scraping/auto-apply around platforms whose terms prohibit it.

---

# 7. Job Normalization

Every job should be converted into a common structure.

## Canonical Job Schema

```text
job_id
company_id
source
source_job_id
ats_type
title
location
remote_type
employment_type
salary_min
salary_max
currency
description
canonical_url
source_posted_at
first_seen_at
last_seen_at
updated_at
status
```

---

# 8. Deduplication

Prevent the same job from appearing multiple times.

Use:

- ATS source ID
- Company
- Canonical URL
- Title
- Location
- Posting ID
- Job fingerprint

Example:

```text
fingerprint =
SHA256(
    company
    + canonical_job_id
)
```

For applications:

```text
UNIQUE(candidate_id, canonical_job_id)
```

This prevents accidental duplicate applications.

---

# 9. Student Role Classifier

Before running expensive AI analysis, filter irrelevant jobs.

## Keep

- Internship
- Intern
- Co-op
- Student
- Apprentice
- Summer analyst
- Summer associate
- New grad
- Graduate program

## Reject

- Senior
- Staff
- Principal
- Manager
- Director
- Experienced hire
- Roles requiring excessive experience

AI should only handle ambiguous cases.

---

# 10. Requirement Extraction

Convert a job description into structured requirements.

Example:

```json
{
  "role": "Software Engineer Intern",
  "skills_required": ["Python", "SQL"],
  "skills_preferred": ["AWS", "Docker"],
  "education_level": "Bachelors",
  "graduation_window": "2027-2028",
  "minimum_experience_years": 0,
  "work_authorization": "US",
  "sponsorship": "unknown",
  "citizenship_required": false,
  "clearance_required": false,
  "location": ["New York"],
  "remote": true,
  "salary_min": 25
}
```

---

# 11. Hard Eligibility Engine

Eligibility should be separate from AI match scoring.

## Example

```text
Eligibility
────────────────────────
Internship                ✓
Location                  ✓
Graduation requirement    ✓
Degree requirement        ✓
Work authorization        ✓
Citizenship requirement   ✓
Experience requirement    ✓

ELIGIBLE ✓
```

If a job fails a hard requirement:

```text
Eligibility = FAIL
→ DO NOT APPLY
```

Examples:

- Requires a master's degree
- Requires citizenship user does not have
- Requires security clearance
- Requires unsupported relocation
- Requires experience above allowed threshold

---

# 12. Job Fit Engine

Only eligible jobs receive a fit score.

## Suggested Scoring

```text
Role similarity          25%
Skill alignment          25%
Experience alignment     15%
Project relevance        10%
Education alignment      10%
Location                 10%
Posting freshness         5%
```

Example:

```text
FIT SCORE: 92%
```

---

# 13. Resume Coverage Score

Job fit and resume quality should be separate.

Example:

```text
JOB FIT: 93%

RESUME COVERAGE: 74%
```

This means the user may be qualified, but the resume is not communicating it effectively.

---

# 14. AI Resume Builder

The resume builder should:

- Use structured resume data
- Compare against job requirements
- Identify missing keywords
- Rewrite bullets
- Reorder relevant content
- Generate ATS-friendly versions
- Never fabricate qualifications
- Export PDF
- Store resume versions
- Track which resume was used for each application

## Resume Flow

```text
Master Resume
      │
      ▼
Job requirements
      │
      ▼
Resume Agent
      │
      ▼
Resume JSON
      │
      ▼
ATS Template Renderer
      │
      ▼
PDF
      │
      ▼
Parse PDF again
      │
      ▼
Validate ATS readability
```

---

# 15. Cover Letter Builder

Generate tailored cover letters using:

- Candidate profile
- Truth ledger
- Job description
- Selected resume
- Company information

Options:

- Professional
- Conversational
- Enthusiastic
- Concise

Length:

- Short
- Standard
- Detailed

---

# 16. Application Answer Bank

Store common application answers.

Examples:

- Are you authorized to work in the US?
- Will you require sponsorship?
- Why are you interested in this role?
- Describe a project you are proud of.
- Why this company?
- Preferred location
- Salary expectations

Custom AI answers should receive a confidence score.

Unknown answers should pause automation rather than being invented.

---

# 17. Application Confidence

Separate from job fit.

Example:

```text
JOB FIT
94%

APPLICATION CONFIDENCE
98%
```

Application confidence should consider:

```text
Known standard fields    30%
Legal/profile answers    20%
Form parsing             20%
Custom question answers  15%
Document readiness       10%
Submission reliability    5%
```

---

# 18. Auto-Apply Rules

Example:

```yaml
roles:
  - Software Engineer Intern
  - AI/ML Intern
  - Cybersecurity Intern

locations:
  - New York
  - Remote

minimum_fit_score: 88

minimum_application_confidence: 95

maximum_posting_age_hours: 72

daily_application_limit: 25

maximum_applications_per_company: 3

auto_apply:
  greenhouse: true
  lever: true
  ashby: review
  workday: review
  unknown: false
```

---

# 19. Application Preflight

Immediately before submitting:

```text
Job still open?                  ✓
Not previously applied?          ✓
Company not blacklisted?         ✓
Eligibility still passes?        ✓

Resume generated?                ✓
Resume validated?                ✓
Cover letter required?           No

Application fields detected:     17
Known answers:                   15
AI-safe answers:                  2
Unknown:                          0

CAPTCHA detected?                No
Login required?                  No

Application confidence: 98%

AUTO APPLY AUTHORIZED
```

---

# 20. Shadow Mode

Before true auto-submit, run the system in Shadow Mode.

The bot:

- Finds the job
- Scores the job
- Generates resume
- Generates cover letter
- Fills the application
- Answers questions
- Stops before Submit

The user verifies:

```text
Would have applied: YES

Application confidence: 97%

All fields correct?
[Yes] [No]
```

This data is used to measure adapter reliability.

---

# 21. ATS Adapter Trust Levels

```text
LEVEL 0
Unsupported
→ Manual

LEVEL 1
Detect + parse
→ Manual

LEVEL 2
Autofill
→ Review

LEVEL 3
Reliable autofill
→ Review + submit

LEVEL 4
Trusted autopilot
→ Auto-submit
```

Adapters should only be promoted after real testing.

---

# 22. Playwright Application Workers

Each ATS should have a separate adapter.

```text
adapters/
  greenhouse/
  lever/
  ashby/
  workday/
  smartrecruiters/
  icims/
  generic/
```

Each adapter should know how to:

- Detect fields
- Fill text fields
- Select dropdowns
- Upload resumes
- Upload cover letters
- Answer required questions
- Validate required fields
- Detect errors
- Detect CAPTCHA
- Detect login requirements
- Detect successful submission
- Save screenshots

CAPTCHA or verification steps should pause the workflow for the user.

---

# 23. Application Workflow State Machine

Every application should be resumable.

```text
DISCOVERED
   ↓
NORMALIZED
   ↓
ELIGIBLE
   ↓
MATCHED
   ↓
MATERIALS_READY
   ↓
PREFLIGHTED
   ↓
QUEUED
   ↓
APPLYING
   ↓
SUBMITTED_PENDING_CONFIRMATION
   ↓
CONFIRMED
```

Exception states:

```text
WAITING_FOR_USER
CAPTCHA
LOGIN_REQUIRED
AMBIGUOUS_QUESTION
JOB_CLOSED
FAILED
SKIPPED
```

---

# 24. Application Tracker

Track:

```text
Company
Role
Location
Salary
Job URL
Date discovered
Date applied
Resume used
Cover letter used
Answers submitted
Recruiter
Status
Interview dates
Notes
```

Statuses:

```text
Saved
Ready to Apply
Applied
Confirmed
OA
Interview
Final Round
Offer
Rejected
Withdrawn
Ghosted
Closed
```

---

# 25. Gmail Status Tracking

After submission:

```text
SUBMITTED_PENDING_CONFIRMATION
```

When Gmail detects:

```text
"Thank you for applying..."
```

update:

```text
CONFIRMED
```

Other examples:

```text
"After careful consideration..."
→ REJECTED

"We would like to schedule..."
→ INTERVIEW

"Please complete this assessment..."
→ OA
```

---

# 26. Contact Finder

Find relevant professional contacts such as:

- University recruiters
- Technical recruiters
- Hiring managers
- Engineering managers
- Campus recruiters

Use legitimate enrichment APIs and publicly available professional data.

Avoid scraping private data.

Possible providers:

- Hunter
- People Data Labs
- Similar enrichment APIs

---

# 27. Recruiter Outreach

Generate outreach drafts.

Example:

```text
Hi Jane,

I recently applied for Company X's Software Engineering Internship and wanted to introduce myself...
```

Track:

- Contact
- Email
- Date contacted
- Follow-up date
- Response
- Application association

Sending should initially remain user-controlled.

---

# 28. Internship Alerts

Example alert:

```text
Software Engineering Intern
Location: NYC / Remote
Posted: < 24 hours
Minimum Match: 85%
```

Notifications can eventually support:

- Dashboard
- Email
- Discord
- Push
- SMS

---

# 29. Analytics

Track:

```text
Applications
Responses
Interviews
Offers
Response Rate
Interview Rate
Offer Rate
```

Also analyze:

- Resume performance
- Job source performance
- Match-score performance
- Role category
- Company
- Location
- ATS
- Posting freshness

Example:

```text
Resume A
52 applications
3 interviews
5.8%

Resume B
31 applications
5 interviews
16.1%
```

---

# 30. Recommended V1 Stack

Use TypeScript throughout V1.

```text
Frontend
Next.js + TypeScript

Backend
Next.js API / Node services

Database
PostgreSQL

Queue
Redis + BullMQ initially

Browser Automation
Playwright

AI
OpenAI / other models through an AI gateway

Files
Local development initially
S3 in production

Deployment
AWS
```

---

# 31. AWS Learning + Deployment Plan

AWS should be the production target while the homelab remains useful for development, testing, local AI, and experiments.

## AWS Progression

```text
PHASE 1
EC2 + Docker
      ↓

PHASE 2
EC2 + RDS + S3
      ↓

PHASE 3
+ SQS + EventBridge
      ↓

PHASE 4
ECR + ECS
      ↓

PHASE 5
Fargate + Auto Scaling
      ↓

PHASE 6
ElastiCache + CloudWatch
      ↓

FULL AWS ARCHITECTURE
```

---

# 32. AWS Phase 1 — EC2

Start with one Ubuntu EC2 instance.

```text
EC2
│
├── Docker
├── Next.js
├── Scraper Worker
├── Playwright
├── PostgreSQL
├── Redis
└── Nginx
```

Learn:

- EC2
- SSH
- Linux
- IAM
- VPC
- Security Groups
- Networking
- Docker
- Environment variables
- DNS basics

---

# 33. AWS Phase 2 — RDS + S3

Move PostgreSQL to Amazon RDS.

```text
EC2
├── App
└── Workers
      │
      ▼
Amazon RDS
PostgreSQL
```

Store files in S3.

```text
S3

/users/{user_id}/
    resumes/
    cover-letters/
    application-screenshots/
    application-artifacts/
```

---

# 34. AWS Phase 3 — SQS + EventBridge

EventBridge schedules scans.

```text
EventBridge
     ↓
    SQS
     ↓
Scraper Workers
```

Possible queues:

```text
job-discovered
eligible-job
resume-generation
application-ready
application-submit
application-status-update
```

---

# 35. AWS Phase 4 — ECS

Move Docker containers into ECS.

```text
ECS

Web Service
├── web container

Scraper Service
├── scraper-1
├── scraper-2
└── scraper-N

Application Workers
├── playwright-1
├── playwright-2
└── playwright-N

AI Workers
├── ai-worker-1
└── ai-worker-N
```

---

# 36. AWS Phase 5 — Fargate + Auto Scaling

Move selected workloads to ECS Fargate.

Scale based on queue load.

```text
Queue: 10 jobs
→ 1 worker

Queue: 100 jobs
→ 3 workers

Queue: 1,000 jobs
→ 10 workers
```

---

# 37. AWS Phase 6 — ElastiCache + CloudWatch

Move Redis to ElastiCache.

Use CloudWatch for:

- Logs
- Metrics
- Alerts
- Adapter health
- Queue depth
- Scraper errors
- Application success rate

Example:

```text
Greenhouse failure rate > 20%
        ↓
CloudWatch Alarm
        ↓
Disable Greenhouse auto-submit
        ↓
Alert user
```

---

# 38. Final AWS Architecture

```text
YOUR MAC
   │
   │ Git push
   ▼
 GitHub
   │
   ▼
──────────────────────── AWS ───────────────────────

                    Internet
                       │
                       ▼
                 Load Balancer
                       │
                       ▼
                  ECS Web App
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
       RDS            SQS            S3
    PostgreSQL       Queues        Documents
                       │
                       ▼
                    ECS Workers
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Scrapers      AI Workers   Playwright
                                      │
                                      ▼
                               Employer ATS Sites

                  EventBridge
                       │
                       ▼
                   Schedulers

                  CloudWatch
                       │
               Logs / Metrics / Alerts
```

---

# 39. Homelab Role

The homelab should still be useful.

```text
YOUR HOMELAB

Development
Testing
Experimental scrapers
Local AI models
Database backups
Staging
Playwright testing
```

Potential future hybrid design:

```text
AWS
 │
 │ secure connection
 ▼
Homelab GPU
 │
 ▼
Local AI model
```

---

# 40. Development Roadmap

## Phase 1 — Foundation

Build:

- Monorepo
- Next.js
- PostgreSQL
- Redis
- Unified profile
- Truth ledger
- Candidate preferences
- Application answer bank
- Company registry
- Canonical job schema
- Job/application event logs

---

## Phase 2 — Discovery

Build:

- Greenhouse adapter
- Lever adapter
- Ashby adapter
- Continuous scanning
- Adaptive polling
- First-seen tracking
- Deduplication
- Job dashboard
- Internship alerts

---

## Phase 3 — Intelligence

Build:

- Student role classifier
- Requirement extraction
- Hard eligibility engine
- Match engine
- Resume coverage analysis
- Match explanations

---

## Phase 4 — Documents

Build:

- Structured resume builder
- Resume versioning
- ATS PDF renderer
- ATS validation
- Job-specific resume tailoring
- Cover letter generator

---

## Phase 5 — Application Engine

Build:

- Application question bank
- Application confidence
- Greenhouse Playwright adapter
- Autofill
- Resume upload
- Cover letter upload
- Screenshots
- Application preflight
- Workflow state machine
- Shadow Mode

---

## Phase 6 — Autopilot

Build:

- Adapter trust levels
- Trusted auto-submit
- Application thresholds
- Daily limits
- Company limits
- Duplicate protection
- Retry handling
- Pause button
- Automatic adapter disable on high failure rate

---

## Phase 7 — Tracking

Build:

- Gmail integration
- Confirmation detection
- Rejection detection
- OA detection
- Interview detection
- Offer detection
- Automatic tracker updates

---

## Phase 8 — Career CRM

Build:

- Contact enrichment
- Recruiter finder
- Recruiter ranking
- Outreach drafts
- Contact history
- Follow-up tracker

---

## Phase 9 — Learning System

Analyze:

- Resume performance
- Application response rates
- Role performance
- Company performance
- ATS success
- Source freshness
- Match-score accuracy
- Application strategy

---

# 41. V1 Definition

The first version worth actively using should include:

```text
Unified Profile
        +
Truth Ledger
        +
Company Registry
        +
Greenhouse / Lever / Ashby Monitoring
        +
Continuous Scanning
        +
Job Database
        +
Student Role Filtering
        +
Eligibility Engine
        +
Match Scoring
        +
Internship Alerts
        +
Resume Builder
        +
Cover Letter Builder
        +
Application Answer Bank
        +
Greenhouse Autofill
        +
Application Preflight
        +
Shadow Mode
        +
Application Tracker
```

---

# 42. V1.5 — Trusted Autopilot

```text
Trusted ATS adapter
+
Eligibility = PASS
+
Fit ≥ configured threshold
+
Application confidence ≥ configured threshold
+
No CAPTCHA / verification
+
Within daily limits
+
No duplicate application
        ↓
AUTO SUBMIT
```

---

# 43. Scaling Goal

Do not attempt to monitor 100,000 companies immediately.

Initial target:

```text
1,000–5,000
high-quality company boards
```

Focus on:

- Reliable scanning
- Fast detection
- Strong normalization
- Correct deduplication
- High-quality eligibility analysis
- Reliable ATS adapters

Then scale:

```text
5,000
 ↓
10,000
 ↓
25,000
 ↓
50,000
 ↓
100,000+
```

---

# 44. First Major Milestone

The first major milestone should be:

> A server running 24/7 that monitors thousands of company career boards, discovers new internships within minutes, determines whether the user is eligible, scores each job against their profile, and displays high-quality matches immediately in the dashboard.

After that is reliable:

```text
Discovery
   ↓
Eligibility
   ↓
Matching
   ↓
Resume
   ↓
Application
   ↓
Autopilot
```

---

# 45. Long-Term Goal

The final product should work like this:

```text
Continuously monitor companies
           ↓
New internship detected
           ↓
Verify posting
           ↓
Check eligibility
           ↓
Calculate fit
           ↓
Tailor resume
           ↓
Generate cover letter if needed
           ↓
Prepare application answers
           ↓
Run application preflight
           ↓
Evaluate application confidence
           ↓
Trusted ATS?
       ┌───┴────┐
       │        │
      Yes       No
       │        │
       ▼        ▼
 Auto Submit   Review
       │
       ▼
Verify submission
       │
       ▼
Track confirmation
       │
       ▼
Monitor Gmail
       │
       ▼
OA / Interview / Rejection / Offer
       │
       ▼
Analytics + Learning
```

The product's key differentiator is:

> **Continuous discovery → true eligibility analysis → automatic resume optimization → application preflight → trusted auto-submit → automatic status tracking.**
