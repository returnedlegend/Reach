import type { FoodRanking } from "./food-ai-ranking";

/** Reconcile a response with the current directory after expiry, moderation or refresh. */
export function displayRanking(
  suggested: FoodRanking,
  fallback: FoodRanking,
  allowedIds: ReadonlySet<string>,
): FoodRanking {
  const seen = new Set<string>();
  return [...suggested, ...fallback]
    .filter((item) => {
      if (!allowedIds.has(item.id) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 3);
}
