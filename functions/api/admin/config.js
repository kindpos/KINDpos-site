// GET/POST /api/admin/config — intentionally retired (PROVISIONING_FLOW.md §11).
//
// The pre-rebuild handler returned the ADMIN_SECRET to any anonymous caller,
// which was the leak motivating the auth replacement. The replacement is
// `POST /api/admin/auth/login` plus cookie-based session middleware (K3).
//
// We return 410 Gone rather than letting the route fall through to 404 so a
// cached client or stale frontend gets an unambiguous "this is dead, use the
// new endpoint" signal instead of a generic missing-route response.

function gone() {
  return new Response(
    JSON.stringify({
      error: "endpoint retired",
      migration: "use POST /api/admin/auth/login",
    }),
    {
      status: 410,
      headers: { "content-type": "application/json" },
    },
  );
}

export const onRequestGet = gone;
export const onRequestPost = gone;
export const onRequest = gone;
