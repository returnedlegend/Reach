import { AccountError } from "../../../lib/account-store";
import { privateResponse, readPrivateJson } from "../../../lib/access-http";
import { z } from "zod";
import { demoData } from "../../../data/demo";
import { productionData } from "../../../data/coverage";
import { planVisits, validateInput } from "../../../lib/planner";
import { publicDirectory } from "../../../lib/public-directory";
const requestSchema = z
  .object({
    demo: z.boolean().default(false),
    input: z
      .object({
        originId: z.string().min(1).max(100),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        earliestDeparture: z.string().regex(/^\d{2}:\d{2}$/),
        latestReturn: z.string().regex(/^\d{2}:\d{2}$/),
        mode: z.enum(["bus", "walk"]),
        maxWalkMiles: z.number().min(0).max(20),
        visitMinutes: z.number().int().min(5).max(240),
        appointmentStatus: z.enum(["booked", "not-booked", "unknown"]),
        arrivalBufferMinutes: z.number().int().min(0).max(60).optional(),
        boardingBufferMinutes: z.number().int().min(0).max(60).optional(),
        skipDepartures: z.number().int().min(0).max(10).optional(),
      })
      .strict(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    // Bound bytes while streaming, before JSON parsing or database access.
    const { demo, input } = await readPrivateJson(request, requestSchema, 8192);
    const directory = demo ? null : publicDirectory();
    if (!demo && (directory?.error || !directory?.pantries.length))
      return privateResponse(
        {
          error:
            "Verified local routing is not available yet. Official sources must be reviewed before travel plans can be offered.",
          coverage: "unverified",
        },
        503,
      );
    const data = demo
      ? demoData
      : { ...productionData, pantries: directory!.pantries };
    const errors = validateInput(input, data);
    if (errors.length) return privateResponse({ error: errors.join(" ") }, 400);
    if (!data.origins.some((x) => x.id === input.originId))
      return privateResponse(
        { error: "Select a supported starting landmark." },
        400,
      );
    return privateResponse({
      demo,
      timezone: data.transit.timezone,
      results: planVisits(input, data),
    });
  } catch (error) {
    return privateResponse(
      {
        error:
          error instanceof AccountError
            ? error.message
            : "The planner is temporarily unavailable. Try again later.",
      },
      error instanceof AccountError ? error.status : 503,
    );
  }
}
