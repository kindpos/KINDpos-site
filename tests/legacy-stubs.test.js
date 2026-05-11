import { describe, it, expect } from "vitest";
import { onRequest as activateHandler } from "../functions/api/activate.js";
import { onRequest as validateHandler } from "../functions/api/validate.js";
import { onRequest as checkinHandler } from "../functions/api/checkin.js";

function makeRequest(path, method = "POST") {
  return new Request(`https://kindpos.com${path}`, { method });
}

describe("legacy 410 stubs", () => {
  it("POST /api/activate returns 410", async () => {
    const resp = await activateHandler({ request: makeRequest("/api/activate") });
    expect(resp.status).toBe(410);
    const body = await resp.json();
    expect(body.error).toBe("endpoint retired");
  });

  it("POST /api/validate returns 410", async () => {
    const resp = await validateHandler({ request: makeRequest("/api/validate") });
    expect(resp.status).toBe(410);
    const body = await resp.json();
    expect(body.error).toBe("endpoint retired");
  });

  it("POST /api/checkin returns 410", async () => {
    const resp = await checkinHandler({ request: makeRequest("/api/checkin") });
    expect(resp.status).toBe(410);
    const body = await resp.json();
    expect(body.error).toBe("endpoint retired");
  });

  it("GET /api/activate also returns 410 (onRequest catches all methods)", async () => {
    const resp = await activateHandler({ request: makeRequest("/api/activate", "GET") });
    expect(resp.status).toBe(410);
  });
});
