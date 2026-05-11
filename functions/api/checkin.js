// functions/api/checkin.js
// PROVISIONING_FLOW.md §11 — retired.
// Replaced by POST /api/notify/heartbeat.
export function onRequest() {
  return new Response(
    JSON.stringify({ error: "endpoint retired", migration: "use POST /api/notify/heartbeat" }),
    { status: 410, headers: { "content-type": "application/json" } },
  );
}
