// PROVISIONING_FLOW.md §5, §8 — welcome email template + Resend transport.
// Single-fetch Resend integration; no npm package required.

export async function sendEmail({ apiKey, to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'KINDpos Onboarding <onboarding@kindpos.com>',
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend error ${res.status}: ${err.message || 'unknown'}`);
  }
  return res.json();
}

// PROVISIONING_FLOW.md §5 — customer-facing welcome email body.
// downloadBlock appears only when platform === 'windows' AND a
// provisioning_url is available. The plaintext token is shown once at
// build time and is not stored (§3.2 item 6) — for Windows customers
// the admin currently relays the URL out-of-band along with the
// temporary password.
export function buildWelcomeEmail({
  store_name, customer_email, temp_password,
  platform, provisioning_url,
}) {
  const downloadBlock = platform === 'windows' && provisioning_url
    ? `Download your setup file:\n${provisioning_url}\n\n` +
      `This link expires in 7 days or after first use.\n\n`
    : '';

  return `Hi ${store_name},

Your KINDpos system is on its way.

${downloadBlock}Log in with these credentials:

  Email:    ${customer_email}
  Password: ${temp_password}

You'll be asked to set a new password on first login.

Keep this email somewhere safe — your password is only shown once.

Questions? Reply to this email.

— The KINDpos team`;
}
