// POST /api/admin/auth/logout (PROVISIONING_FLOW.md §12).
//
// Requires a valid session cookie; revokes the row in `admin_sessions` and
// returns 204 with a clear-cookie Set-Cookie header. Both pieces are needed
// — the DB revocation is what actually enforces logout for shared/stolen
// cookies, while the browser-side clear keeps the UI tidy.

import { revokeAdminSession } from "../../../lib/auth/admin_sessions.js";
import {
  buildClearCookie,
  requireAdminAuth,
} from "../../../lib/auth/middleware.js";

export async function onRequestPost({ request, env }) {
  try {
    const session = await requireAdminAuth(request, env);
    await revokeAdminSession(env.KINDPOS_DB, session.session_id);
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": buildClearCookie() },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
