import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Unit fixtures choose their own canonical origins. A deployed/cloud origin
    // must not make localhost fixtures fail before exercising their assertions.
    env: { REACH_APP_ORIGIN: "", REACH_COMMUNITY_ORIGIN: "" },
  },
});
