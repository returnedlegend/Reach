import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/plan/route";
import { demoData } from "../src/data/demo";

vi.mock("../src/lib/public-directory", () => ({
  publicDirectory: () => ({
    resources: [],
    pantries: [],
    error: "Unavailable",
  }),
}));
const valid = {
  demo: true,
  input: {
    originId: demoData.origins[0].id,
    date: "2026-10-23",
    earliestDeparture: "08:00",
    latestReturn: "14:00",
    mode: "walk",
    maxWalkMiles: 3,
    visitMinutes: 20,
    appointmentStatus: "unknown",
  },
};
const request = (body: unknown) =>
  new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.useRealTimers());
describe("planner API request safeguards", () => {
  it("preserves explicitly labelled sample planning and privacy headers", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      demo: true,
      timezone: "America/Chicago",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it("rejects unknown fields instead of silently discarding them", async () => {
    for (const body of [
      { ...valid, unknown: true },
      { ...valid, input: { ...valid.input, unknown: true } },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });
  it("stops reading and cancels oversized streamed bodies without Content-Length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await POST(
      new Request("http://localhost/api/plan", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });
  it("bounds incomplete request streams in time", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const pending = POST(
      new Request("http://localhost/api/plan", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    await vi.advanceTimersByTimeAsync(4001);
    expect((await pending).status).toBe(400);
    expect(cancelled).toBe(true);
  });
  it("returns explicit unavailable status when the real directory cannot load", async () => {
    const response = await POST(request({ ...valid, demo: false }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ coverage: "unverified" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
