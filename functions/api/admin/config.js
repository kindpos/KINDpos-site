// functions/api/admin/config.js
// Retired — PROVISIONING_FLOW.md §11
// Previously leaked the admin secret to any unauthenticated caller.
// Admin auth is now handled by POST /api/admin/auth/login.
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'gone', message: 'This endpoint has been retired. Use /api/admin/auth/login.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
}
