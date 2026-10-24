import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  writeFile: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => undefined),
  readFile: vi.fn(
    async () => "41 30 0:37 / /var/lib/reach rw,relatime - ext4 /dev/sda rw",
  ),
  open: vi.fn(async () => ({
    writeFile: io.writeFile,
    sync: io.sync,
    close: io.close,
  })),
  unlink: io.unlink,
}));
import { runReleasePreflight } from "../scripts/release-preflight";
const previousExit = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  io.writeFile.mockResolvedValue(undefined);
  io.sync.mockResolvedValue(undefined);
  io.close.mockResolvedValue(undefined);
  io.unlink.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = previousExit;
  vi.restoreAllMocks();
});
describe("startup storage fault injection (synthetic, not a filled real disk)", () => {
  it.each(["writeFile", "sync"] as const)(
    "fails closed and cleans up if the %s probe fails",
    async (method) => {
      io[method].mockRejectedValueOnce(
        Object.assign(new Error("Synthetic storage failure"), {
          code: method === "writeFile" ? "ENOSPC" : "EIO",
        }),
      );
      expect(
        await runReleasePreflight({
          REACH_DOMAIN: "reach.test",
          REACH_APP_ORIGIN: "https://reach.test",
          REACH_COMMUNITY_DB: "/var/lib/reach/community.sqlite",
          REACH_RELEASE_PROFILE: "core",
          OSM_ROUTER_MODE: "disabled",
        }),
      ).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(io.writeFile).toHaveBeenCalledWith(expect.any(Buffer));
      expect(io.close).toHaveBeenCalled();
      expect(io.unlink).toHaveBeenCalled();
    },
  );
});
