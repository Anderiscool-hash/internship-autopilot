/**
 * Where an alert goes (spec §28: dashboard, email, Discord, push, SMS).
 *
 * Two channels exist today. The dashboard is not one of them — the dashboard
 * already shows every job, so "alerting" it would mean writing a row nobody
 * reads. What the dashboard needs is the EventLog entry that `dispatch.ts`
 * writes regardless of channel.
 *
 * Everything else (email, push, SMS) is the same shape: a function that takes
 * text and delivers it. Adding one means adding a function here, not touching
 * the dispatcher.
 */

/** A destination for alert text. Returns when delivery has been accepted. */
export type AlertChannel = (message: string) => Promise<void>;

/** Logs the alert to stdout. Always available, and useful on its own. */
export const consoleChannel: AlertChannel = async (message) => {
  console.log(`\n--- ALERT ---\n${message}\n-------------\n`);
};

/**
 * Post the alert to a webhook.
 *
 * The body is `{ "content": "..." }`, which is what a Discord webhook expects
 * and what most other webhook receivers will accept or ignore harmlessly.
 *
 * A non-2xx response throws, so the dispatcher can decline to mark the jobs as
 * alerted and try them again next cycle — an alert that was silently dropped
 * is worse than one that arrives late.
 */
export function webhookChannel(url: string, timeoutMs = 10_000): AlertChannel {
  return async (message) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`webhook responded ${response.status} ${response.statusText}`);
    }
  };
}

/**
 * The channels configured by the environment.
 *
 * `ALERT_WEBHOOK_URL` is the generic name; `DISCORD_WEBHOOK_URL` is accepted
 * because that is what the spec names and what the URL will actually be. With
 * neither set, alerts still run — they are logged and recorded — so the whole
 * pipeline is exercised and nothing is silently disabled waiting on a secret.
 */
export function channelsFromEnv(env: NodeJS.ProcessEnv = process.env): AlertChannel[] {
  const channels: AlertChannel[] = [consoleChannel];

  const url = env.ALERT_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL;
  if (url && url.trim().length > 0) {
    channels.push(webhookChannel(url.trim()));
  }

  return channels;
}
