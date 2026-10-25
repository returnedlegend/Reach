import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodSearchHandler } from "../src/lib/food-search-service";
import type { AIServiceStatus } from "../src/lib/ai-config";
const status = (): AIServiceStatus => ({
  state: "configured",
  code: null,
  message: "Test fixture",
  model: "deepseek-flash",
});
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/food-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());
describe("optional AI food-request interpretation", () => {
  it("works in core with no AI credentials, without bypassing the release gate", async () => {
    vi.stubEnv("REACH_RELEASE_PROFILE", "core");
    const interpret = vi.fn();
    const response = await createFoodSearchHandler({ interpret })(
      request({ message: "Food in Bryan", useAI: true }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).assistance).toBe("directory");
    expect(interpret).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("requires opt-in even with AI configured", async () => {
    const interpret = vi.fn();
    await createFoodSearchHandler({ status, interpret })(
      request({ message: "food please" }),
    );
    expect(interpret).not.toHaveBeenCalled();
  });
  it("returns only bounded interpretation, never generated facts or an origin", async () => {
    const interpret = vi.fn().mockResolvedValue({
      status: "available",
      assistance: "ai",
      needs: { service: "prepared-meals" },
      patch: {
        mode: "transit",
        origin: { lat: 91, lng: 2 },
        eligibilityConfirmed: true,
      },
      message: "Invented stock claim",
    });
    const body = await (
      await createFoodSearchHandler({ status, interpret })(
        request({ message: "I need something ready to eat", useAI: true }),
      )
    ).json();
    expect(body).toEqual({
      assistance: "ai",
      intent: { service: "prepared-meals", mode: "transit" },
    });
    expect(JSON.stringify(interpret.mock.calls[0][0])).not.toContain("origin");
  });
  it("keeps results usable when interpretation fails", async () => {
    const interpret = vi
      .fn()
      .mockRejectedValue(new Error("Synthetic provider outage"));
    const response = await createFoodSearchHandler({ status, interpret })(
      request({ message: "food please", useAI: true }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).assistance).toBe("directory");
  });
  it("never accepts an AI travel mode explicitly rejected by the person", async () => {
    const interpret = vi.fn().mockResolvedValue({
      status: "available",
      assistance: "ai",
      patch: { mode: "walking" },
    });
    const body = await (
      await createFoodSearchHandler({ status, interpret })(
        request({ message: "I need food and cannot walk", useAI: true }),
      )
    ).json();
    expect(body.intent.mode).toBeUndefined();
  });
  it("rejects cross-origin and invalid coordinate fields", async () => {
    const handler = createFoodSearchHandler();
    expect(
      (await handler(request({ message: "food" }, "https://other.example")))
        .status,
    ).toBe(403);
    expect(
      (await handler(request({ message: "food", origin: { lat: 91, lng: 2 } })))
        .status,
    ).toBe(400);
    expect((await handler(request({ message: "a".repeat(1201) }))).status).toBe(
      400,
    );
  });
  it("limits repeated API requests while the client directory remains independent", async () => {
    const handler = createFoodSearchHandler();
    for (let i = 0; i < 20; i++)
      expect((await handler(request({ message: "food" }))).status).toBe(200);
    expect((await handler(request({ message: "food" }))).status).toBe(429);
  });
});
it("explains disabled configuration without attempting inference", async () => {
  const interpret = vi.fn();
  const response = await createFoodSearchHandler({
    interpret,
    status: () => ({
      ...status(),
      state: "disabled",
      code: "disabled",
      message: "AI is disabled on this server.",
    }),
  })(request({ message: "food", useAI: true }));
  expect(await response.json()).toMatchObject({
    assistance: "directory",
    aiMessage: "AI is disabled on this server.",
  });
  expect(interpret).not.toHaveBeenCalled();
});
it("preserves the actionable provider failure while keeping pantry matching", async () => {
  const response = await createFoodSearchHandler({
    status,
    interpret: vi.fn().mockResolvedValue({
      status: "unavailable",
      message:
        "Local Llama 3.2 network request failed. Manual planning remains available.",
    }),
  })(request({ message: "food", useAI: true }));
  expect(await response.json()).toMatchObject({
    assistance: "directory",
    aiMessage: expect.stringContaining("network request failed"),
  });
});

describe("local development origin validation", () => {
  const localRequest = (
    origin: string | null,
    host = "localhost:3000",
    url = "http://127.0.0.1:3000/api/food-search",
  ) => {
    const headers = new Headers({ host, "content-type": "application/json" });
    if (origin) headers.set("origin", origin);
    headers.set("x-forwarded-host", "localhost:3000");
    return new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Food in Bryan", useAI: true }),
    });
  };
  it("reaches interpretation using localhost with a configured 127.0.0.1 origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REACH_APP_ORIGIN", "http://127.0.0.1:3000");
    const interpret = vi
      .fn()
      .mockResolvedValue({
        status: "available",
        assistance: "ai",
        needs: { service: "food" },
        patch: {},
      });
    const response = await createFoodSearchHandler({ status, interpret })(
      localRequest("http://localhost:3000"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).assistance).toBe("ai");
    expect(interpret).toHaveBeenCalledOnce();
  });
  it.each([
    [null, "localhost:3000", "http://127.0.0.1:3000/api/food-search"],
    [
      "https://evil.example",
      "localhost:3000",
      "http://127.0.0.1:3000/api/food-search",
    ],
    [
      "http://localhost:3001",
      "localhost:3000",
      "http://127.0.0.1:3000/api/food-search",
    ],
    [
      "http://localhost:3000",
      "evil.example",
      "http://127.0.0.1:3000/api/food-search",
    ],
    [
      "http://localhost:3000",
      "localhost:3000",
      "http://evil.example/api/food-search",
    ],
  ])(
    "rejects mismatched origin/host/URL %s %s %s",
    async (origin, host, url) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("REACH_APP_ORIGIN", "http://127.0.0.1:3000");
      const interpret = vi.fn();
      expect(
        (
          await createFoodSearchHandler({ status, interpret })(
            localRequest(origin, host!, url!),
          )
        ).status,
      ).toBe(403);
      expect(interpret).not.toHaveBeenCalled();
    },
  );
  it.each(["production", "test"])(
    "preserves strict canonical checks in %s",
    async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example");
      const interpret = vi.fn();
      expect(
        (
          await createFoodSearchHandler({ status, interpret })(
            localRequest("http://localhost:3000"),
          )
        ).status,
      ).toBe(403);
      expect(interpret).not.toHaveBeenCalled();
    },
  );
  it.each(["https://reach.example", "http://127.0.0.1:3001"])(
    "accepts direct same-origin loopback development despite stale configuration %s",
    async (canonical) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("REACH_APP_ORIGIN", canonical);
      expect(
        (await createFoodSearchHandler()(localRequest("http://localhost:3000")))
          .status,
      ).toBe(200);
    },
  );
});
