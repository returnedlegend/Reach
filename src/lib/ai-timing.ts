// Shared, non-secret budgets. The browser must outlast the server deadline.
export const LOCAL_RANKING_TIMEOUT_MS = 120_000;
export const FOOD_SEARCH_TIMEOUT_MS = LOCAL_RANKING_TIMEOUT_MS + 5_000;
