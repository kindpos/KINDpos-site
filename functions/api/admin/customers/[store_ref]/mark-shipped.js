import { requireAdminAuth } from '../../../../lib/auth/middleware.js';
import { sendEmail, buildWelcomeEmail } from '../../../../lib/email/send.js';

const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequestPost({ request, env, params }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  const user = await requireAdminAuth(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { store_ref } = params;
  const db = env.KINDPOS_DB;

  const customer = await db.prepare(
    `SELECT status, image_r2_key, windows_image_r2_key, installer_token_url,
            pending_api_key_hash, pending_recovery_code_hash,
            customer_email, store_name
     FROM customers WHERE store_ref = ?`,
  ).bind(store_ref).first();
  if (!customer) return json({ error: 'not_found' }, 404);
  if (!customer.image_r2_key) return json({ error: 'image_not_built' }, 409);
  if (customer.status !== 'pending') return json({ error: 'wrong_status' }, 409);

  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      `UPDATE customers SET
         status                     = 'shipped',
         shipped_at                 = ?,
         api_key_hash               = pending_api_key_hash,
         recovery_code_hash         = pending_recovery_code_hash,
         pending_api_key_hash       = NULL,
         pending_recovery_code_hash = NULL
       WHERE store_ref = ?`,
    ).bind(now, store_ref),
    db.prepare(
      `INSERT INTO provisioning_events
         (event_id, store_ref, event_type, event_data, occurred_at)
       VALUES (?, ?, 'shipped', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      store_ref,
      JSON.stringify({ shipped_at: now, shipped_by: user.user_id }),
      now,
    ),
  ]);

  // PROVISIONING_FLOW.md §5, §8 — send the welcome email via Resend.
  // Email failure is non-fatal: mark-shipped still returns 200.
  try {
    const emailBody = buildWelcomeEmail({
      store_name:       customer.store_name,
      customer_email:   customer.customer_email,
      // temp_password is not stored — shown once at build time
      // (§3.2 item 1). Direct the customer to their onboarding contact.
      temp_password:    '(see your onboarding specialist)',
      platform:         customer.windows_image_r2_key ? 'windows' : 'pi',
      provisioning_url: provisioningUrlForEmail(customer),
    });

    await sendEmail({
      apiKey:  env.RESEND_API_KEY,
      to:      customer.customer_email,
      subject: 'Your KINDpos is on its way',
      text:    emailBody,
    });
  } catch (err) {
    console.error('[EMAIL] Failed to send welcome email:', err.message);
  }

  return json({ store_ref, status: 'shipped', shipped_at: now });
}

// installer_token_url is retained until the customer first downloads
// the package (download.js nulls it then). After that, the column is
// NULL and the welcome email omits the Windows download block.
function provisioningUrlForEmail(customer) {
  return customer.installer_token_url ?? null;
}
