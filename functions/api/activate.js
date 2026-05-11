// functions/api/activate.js
// PROVISIONING_FLOW.md §11 — retired.
// Replaced by POST /api/notify/terminal-bound + POST /api/notify/activated.
export function onRequest() {
  return new Response(
    JSON.stringify({ error: "endpoint retired", migration: "use POST /api/notify/activated and POST /api/notify/terminal-bound" }),
    { status: 410, headers: { "content-type": "application/json" } },
  );
}
