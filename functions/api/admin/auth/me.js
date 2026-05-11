// functions/api/admin/auth/me.js
import { requireAdminAuth } from '../../../lib/auth/middleware.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  const user = await requireAdminAuth(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  return json({ user_id: user.user_id, email: user.email, must_change_password: !!user.must_change_password });
}
