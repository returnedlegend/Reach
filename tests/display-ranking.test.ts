import { expect, it } from "vitest";
import { displayRanking } from "../src/lib/display-ranking";
const fallback = ["a", "b", "c"].map((id) => ({
  id,
  reasons: ["Computed from directory"],
}));
it("fills partial rankings and rejects removed or duplicated records", () => {
  const result = displayRanking(
    [
      { id: "retired", reasons: [] },
      { id: "b", reasons: ["AI"] },
      { id: "b", reasons: [] },
    ],
    fallback,
    new Set(["a", "b", "c"]),
  );
  expect(result.map((x) => x.id)).toEqual(["b", "a", "c"]);
  expect(result[0].reasons).toEqual(["AI"]);
});
it("does not invent three matches when the current directory has fewer", () => {
  expect(
    displayRanking(fallback, fallback, new Set(["c"])).map((x) => x.id),
  ).toEqual(["c"]);
  expect(displayRanking(fallback, fallback, new Set())).toEqual([]);
});
