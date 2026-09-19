/**
 * PM2 process list — the Windows-friendly alternative to the systemd units
 * next door. Same three processes, same reasoning.
 *
 *   pm2 start deploy/pm2.config.cjs
 *   pm2 save
 *   pm2 startup          // prints the command that survives a reboot
 *
 * PM2 reads `.env` itself only if you tell it to; this file deliberately does
 * NOT inline any secret. Put them in `.env` beside the repo (it is gitignored)
 * or in the machine's environment.
 *
 * `.cjs` on purpose: package.json has no "type" field today, but PM2 configs
 * must be CommonJS, and the explicit extension keeps that true if someone
 * later sets "type": "module".
 */

module.exports = {
  apps: [
    {
      name: "autopilot-web",
      // Build is a deploy step, not a start step — building on every restart
      // would leave the site down while it worked.
      script: "npm",
      args: "run start",
      cwd: __dirname + "/..",
      env: { NODE_ENV: "production" },
      autorestart: true,
      // One instance. The app is single-user and the apply daemon is
      // explicitly serialized; a cluster would fight over the browser.
      instances: 1,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "autopilot-scanner",
      script: "npm",
      args: "run scan",
      cwd: __dirname + "/..",
      env: { NODE_ENV: "production" },
      autorestart: true,
      instances: 1,
      restart_delay: 30000,
      // The loop traps SIGINT and finishes its current cycle rather than
      // dying mid-board. Give it room to do that.
      kill_timeout: 120000,
    },
    {
      name: "autopilot-daemon",
      script: "npm",
      args: "run daemon",
      cwd: __dirname + "/..",
      env: { NODE_ENV: "production" },
      autorestart: true,
      instances: 1,
      restart_delay: 10000,
      // NOTE: loads the fill logic at startup and never reloads it. After
      // deploying a change to form filling, `pm2 restart autopilot-daemon`
      // or it keeps applying the old rules silently.
    },
  ],
};
