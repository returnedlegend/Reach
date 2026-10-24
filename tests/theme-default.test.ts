import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, resolveTheme, themeBootstrap } from "../src/lib/theme";

function bootstrapTheme(storage: { getItem: () => string | null } | null) {
  const document = {
    documentElement: { dataset: {} as Record<string, string> },
  };
  const context = {
    document,
    localStorage: storage,
  };
  runInNewContext(themeBootstrap, context);
  return document.documentElement.dataset.theme;
}

describe("dark theme default", () => {
  it("uses an explicitly saved light or dark theme in the pre-paint bootstrap", () => {
    expect(bootstrapTheme({ getItem: () => "reach" })).toBe("reach");
    expect(bootstrapTheme({ getItem: () => "reach-dark" })).toBe("reach-dark");
  });

  it("defaults to dark when storage is absent or contains an invalid value", () => {
    expect(bootstrapTheme({ getItem: () => null })).toBe(DEFAULT_THEME);
    expect(bootstrapTheme({ getItem: () => "unknown" })).toBe(DEFAULT_THEME);
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme("unknown")).toBe(DEFAULT_THEME);
  });

  it("defaults to dark when reading storage throws", () => {
    expect(
      bootstrapTheme({
        getItem() {
          throw new Error("storage blocked");
        },
      }),
    ).toBe(DEFAULT_THEME);
  });
});
