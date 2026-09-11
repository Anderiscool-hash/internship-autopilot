# Deploying

Written for putting this on a server you control, reachable at a domain.

## What has to run

Three things, not one:

| Piece | What it is | Can it be serverless? |
| --- | --- | --- |
| The web app | Next.js, this repo | Yes |
| Postgres | The database | Managed service or a container |
| The scanner | `npm run scan` — a long-running loop | **No** |

The scanner is the part that catches people out. It polls job boards on a
schedule and its whole design assumes a process that stays alive (spec §5).
A serverless host will not run it. Either:

- keep the scanner running on a machine you own, pointed at the hosted
  database — perfectly reasonable, and it is where it runs today; or
- deploy to something that runs persistent workers (Fly, Railway, a VPS) and
  run it as a second process.

The web app works fine without the scanner. The job list just stops growing.

## Before anything else: set a password

```
APP_PASSWORD="something long"
```

Local requests never need it. Remote requests are **refused** without it —
a 503 explaining why, rather than the app. This holds work authorization,
graduation date, résumé history and the Truth Ledger, and an unlocked public
copy is a public copy of all of that.

Changing this value signs out every existing session, since the cookie's
signing key is derived from it.

## Environment

| Variable | Needed | Notes |
| --- | --- | --- |
| `DATABASE_URL` | always | Postgres connection string |
| `APP_PASSWORD` | for any remote access | See above |
| `ALERT_WEBHOOK_URL` | optional | Discord-compatible; alerts print to the log without it |
| `ANTHROPIC_API_KEY` | only if the AI provider is Claude | A local model needs no key |

`.env` is git-ignored and no key is ever stored in the database.

## Moving your data

The 2,800 postings and your profile live in the local database. To move them:

```bash
# on this machine
npm run data:export -- ./backup.json

# against the new database
DATABASE_URL="postgresql://..." npx prisma migrate deploy
DATABASE_URL="postgresql://..." npm run data:import -- ./backup.json
```

`migrate deploy` creates the schema; the import moves rows into it. The import
is safe to re-run — rows that are already there are skipped, so an interrupted
transfer just gets run again.

Verified end to end into an empty database: counts matched exactly, dates came
back as dates, and the JSON requirements column survived the round trip.

**`backup.json` contains your profile and Truth Ledger.** It is git-ignored.
Treat it like the personal document it is.

Résumé imports are deliberately excluded from the export — those rows hold the
full text of an uploaded résumé and exist only to carry a parse across one
redirect. There is no reason for them to travel.

## Docker

```bash
docker build -t internship-autopilot .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e APP_PASSWORD="..." \
  internship-autopilot
```

The image runs `prisma migrate deploy` at startup, then the server. Migrations
run at start rather than at build because the schema belongs to the database,
not to the image.

The image contains the app only — no Postgres, no scanner. To run the scanner
in the same image, start a second container with the same environment and
`npm run scan` as the command.

## Health check

`GET /api/health` returns `200` with a row count when the database is
reachable, and `503` when it is not. Point the platform's health check at it.
It is exempt from the password — a load balancer cannot log in, and it reveals
nothing beyond up/down and a count.

## A note on hosting it at a domain you use for something else

If the domain already serves a real site, put this on a subdomain
(`jobs.example.com`) rather than the apex. Cookie scope is the reason: a
session cookie set at the apex is sent to every subdomain, which is more
sharing than this needs.
