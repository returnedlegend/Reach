import { NextResponse } from "next/server";
import { z } from "zod";
import { demoData } from "@/data/demo";
import { productionData } from "@/data/coverage";
import { planVisits, validateInput } from "@/lib/planner";
import { publicDirectory } from "@/lib/public-directory";
const requestSchema = z.object({
  demo: z.boolean().default(false),
  input: z.object({
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
  }),
});
export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 8192)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    const parsed = requestSchema.safeParse(JSON.parse(body));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Check the trip fields and try again." },
        { status: 400 },
      );
    const { demo, input } = parsed.data;
    const directory = demo ? null : publicDirectory();
    if (!demo && (directory?.error || !directory?.pantries.length))
      return NextResponse.json(
        {
          error:
            "Verified local routing is not available yet. Official sources must be reviewed before travel plans can be offered.",
          coverage: "unverified",
        },
        { status: 503 },
      );
    const data = demo
      ? demoData
      : { ...productionData, pantries: directory!.pantries };
    const errors = validateInput(input, data);
    if (errors.length)
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    if (!data.origins.some((x) => x.id === input.originId))
      return NextResponse.json(
        { error: "Select a supported starting landmark." },
        { status: 400 },
      );
    return NextResponse.json({
      demo,
      timezone: data.transit.timezone,
      results: planVisits(input, data),
    });
  } catch {
    return NextResponse.json(
      { error: "The request could not be read." },
      { status: 400 },
    );
  }
}
