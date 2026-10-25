import { createFoodSearchHandler } from "@/lib/food-search-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createFoodSearchHandler();
