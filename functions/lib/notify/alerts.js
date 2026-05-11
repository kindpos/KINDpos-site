// functions/lib/notify/alerts.js
// PROVISIONING_FLOW.md §8 — alert delivery.
// Stubbed: logs to console. Real email/Slack delivery tracked in §12.

/**
 * Fire activation alert to Alex.
 * Called after POST /api/notify/activated succeeds.
 */
export async function sendActivationAlert(env, { customer, activatedAt, terminalCount }) {
  // TODO §12: send email via env.ALERT_EMAIL_TO + Mailchannels/Resend
  // TODO §12: post to env.SLACK_WEBHOOK_URL if configured
  console.log(
    `[ALERT] KINDpos activated: ${customer.store_name ?? customer.store_ref} ` +
    `(${customer.store_ref}) at ${activatedAt} — ${terminalCount} terminal(s)`,
  );
}
