import { describe, it, expect } from "vitest";

import {
  onRequestGet,
  onRequestPost,
} from "./config.js";

describe("/api/admin/config — retired", () => {
  it("returns 410 with the canonical migration body on GET", async () => {
    const resp = await onRequestGet({
      request: new Request("https://kindpos.com/api/admin/config"),
      env: {},
    });
    expect(resp.status).toBe(410);
    expect(resp.headers.get("content-type")).toContain("application/json");
    expect(await resp.json()).toEqual({
      error: "endpoint retired",
      migration: "use POST /api/admin/auth/login",
    });
  });

  it("returns the same 410 body on POST", async () => {
    const resp = await onRequestPost({
      request: new Request("https://kindpos.com/api/admin/config", {
        method: "POST",
      }),
      env: {},
    });
    expect(resp.status).toBe(410);
    expect(await resp.json()).toEqual({
      error: "endpoint retired",
      migration: "use POST /api/admin/auth/login",
    });
  });
});
