import {
  listPantryResources,
  listPlannerPantries,
  openPantryDatabase,
} from "./pantry-store";
import type { Resource } from "@/data/resources";
import type { Pantry } from "./types";

/** Public results always come from the active database, never a stale seed fallback. */
export function publicDirectory(): {
  resources: Resource[];
  pantries: Pantry[];
  error: string;
} {
  try {
    const db = openPantryDatabase();
    return {
      resources: listPantryResources(db),
      pantries: listPlannerPantries(db),
      error: "",
    };
  } catch {
    return {
      resources: [],
      pantries: [],
      error:
        "The pantry directory is temporarily unavailable. Please try again later. Maps, transit information and saved trips remain available.",
    };
  }
}
