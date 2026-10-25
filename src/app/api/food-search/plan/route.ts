import { createFoodPlanHandler } from "@/lib/food-plan-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createFoodPlanHandler();
