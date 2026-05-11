// functions/api/validate.js
// PROVISIONING_FLOW.md §11 — retired.
// Replaced by local token validation per OVERSEER_AUTH.md §7.
export function onRequest() {
  return new Response(
    JSON.stringify({ error: "endpoint retired", migration: "local token validation per OVERSEER_AUTH.md §7" }),
    { status: 410, headers: { "content-type": "application/json" } },
  );
}
