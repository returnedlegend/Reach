import { afterEach, expect, it, vi } from "vitest";
import { localDevelopmentOrigin } from "../src/lib/local-request-origin";
import { accountRequestOrigin } from "../src/lib/auth-origin";
afterEach(() => vi.unstubAllEnvs());
it("uses the direct loopback host for development account requests", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example");
  const request = new Request("http://127.0.0.1:3000/api/account", {
    headers: {
      host: "localhost:3000",
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
    },
  });
  expect(accountRequestOrigin(request)).toBe("http://localhost:3000");
  vi.stubEnv("NODE_ENV", "production");
  expect(accountRequestOrigin(request)).toBe("https://reach.example");
});
it("does not override configured origins for remote or malformed hosts", () => {
  vi.stubEnv("NODE_ENV", "development");
  for (const host of [
    "evil.example",
    "localhost.evil.example",
    "localhost:99999",
    "localhost@evil.example",
  ]) {
    expect(
      localDevelopmentOrigin(
        new Request("http://127.0.0.1:3000", { headers: { host } }),
      ),
    ).toBeNull();
  }
});
