# Running this on a server

Four processes, not one. Three of them must stay alive between requests, so
they need something that restarts them on boot and after a crash. This folder
holds the two usual ways of doing that.

| Process | Command | Must stay alive? |
| --- | --- | --- |
| Web app | `npm run start` (after `npm run build`) | Yes |
| Scanner | `npm run scan` | **Yes — this is the one people forget** |
| Apply daemon | `npm run daemon` | Only when you want to fill applications |
| Postgres | your own install or a managed service | Yes |

The scanner is the part that catches people out. It polls job boards on each
company's own schedule and its whole design assumes a process that stays
alive. A serverless host will not run it, and without it the job list simply
stops growing — quietly, with nothing in the UI to say so.

The apply daemon is not in the older `docs/DEPLOYING.md` because it did not
exist when that was written. The dashboard's "Fill this application for me"
button talks to it over `127.0.0.1:4319`; with the daemon down, that button
has nothing to reach.

## systemd (Linux)

Copy the three unit files somewhere systemd reads, edit the paths and the
user, then enable them:

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now autopilot-web autopilot-scanner
# only if you want unattended filling:
sudo systemctl enable --now autopilot-daemon
```

Each unit reads `EnvironmentFile=/etc/autopilot.env`, so secrets live in one
root-owned file rather than in the unit files, which are world-readable.

```bash
sudo install -m 600 -o root -g root /dev/null /etc/autopilot.env
sudo editor /etc/autopilot.env     # see .env.example for the variable names
```

## PM2 (anywhere Node runs, including Windows)

```bash
npm install -g pm2
pm2 start deploy/pm2.config.cjs
pm2 save
pm2 startup          # prints the command that makes this survive a reboot
```

PM2 is the easier option on Windows, where there is no systemd. The trade-off
is that PM2 itself has to be started at boot, which is what `pm2 startup`
arranges.

## After ANY deploy, restart the apply daemon

The daemon loads the fill logic when it starts and does not reload it. A
daemon left running across a deploy keeps applying the OLD rules, silently.
This was observed during development: two fixed bugs reproduced exactly
because the daemon was stale.

`systemctl restart autopilot-daemon`, or `pm2 restart autopilot-daemon`.

## Things that will bite you

- **`TRUST_LOCAL_REQUESTS` must NOT be set on the server.** It exists so the
  app is usable on a laptop with no password. On a host that accepts traffic
  from anywhere, it disables the only thing standing in front of your
  personal data. Set `APP_PASSWORD` instead.
- **`DOCUMENT_STORAGE_DIR` holds your resume** and `shadow-runs/` holds
  screenshots of filled application forms — your name, address, phone number.
  Both need a real path outside the repo, and neither should ever be served
  by the web server.
- **Back up Postgres, not the files.** Everything the app knows is in the
  database; the repo is replaceable.
