// GET /api/admin/auth/me (PROVISIONING_FLOW.md §12).
//
// Returns the current admin user's profile. Used by admin.html on page load
// to decide whether to render the app shell or redirect to the login screen,
// and to show the email/role of the logged-in operator.
//
// Session refresh is handled by `requireAdminAuth` — each call extends
// `expires_at` by another 24h on activity.

import { getAdminUserById } from "../../../lib/auth/admin_users.js";
import { requireAdminAuth } from "../../../lib/auth/middleware.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await requireAdminAuth(request, env);
    const user = await getAdminUserById(env.KINDPOS_DB, session.admin_user_id);
    if (!user || !user.is_active) {
      return jsonResponse(401, { error: "invalid credentials" });
    }
    return jsonResponse(200, {
      user_id: user.id,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
      last_login_at: user.last_login_at,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
