import { z } from "zod";
import { isDate } from "./time";
import type { SavedPlan } from "./trip-card";
const text = z.string().max(3000);
const url = z
  .string()
  .url()
  .refine((v) => v.startsWith("https://"));
const source = z.object({
  id: text,
  title: text,
  url: url.optional(),
  checkedOn: text.optional(),
  fictional: z.boolean().optional(),
  verificationMethod: z
    .enum(["website", "provider-confirmation", "fictional"])
    .optional(),
});
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  id: text,
  savedAt: z.string().datetime(),
  demo: z.boolean(),
  originName: text,
  placeNames: z.record(z.string(), text).optional(),
  input: z.object({
    originId: text,
    date: z.string().refine(isDate),
    earliestDeparture: clock,
    latestReturn: clock,
    mode: z.enum(["bus", "walk"]),
    maxWalkMiles: z.number().nonnegative(),
    visitMinutes: z.number().positive(),
    appointmentStatus: z.enum(["booked", "not-booked", "unknown"]),
  }),
  result: z.object({
    pantryId: text,
    status: z.enum(["fits", "confirm", "no"]),
    windowId: text.optional(),
    arrival: z.number().nonnegative().optional(),
    returnAt: z.number().nonnegative().optional(),
    walkingMiles: z.number().nonnegative().optional(),
    reasons: z.array(text).max(100),
    sources: z.array(source).max(30),
    segments: z
      .array(
        z.object({
          kind: z.enum(["walk", "bus", "wait", "visit"]),
          from: text,
          to: text,
          start: z.number().nonnegative(),
          end: z.number().nonnegative(),
          miles: z.number().nonnegative().optional(),
          route: text.optional(),
        }),
      )
      .max(100),
  }),
  pantry: z.object({
    id: text,
    name: text,
    address: text,
    windows: z
      .array(
        z.object({
          id: text,
          opens: clock,
          closes: clock,
          registrationOpens: clock.optional(),
          registrationCutoff: clock.optional(),
          distributionCutoff: clock.optional(),
          appointmentRequired: z.boolean().optional(),
        }),
      )
      .max(50),
    notes: text.optional(),
    phone: text.optional(),
    serviceArea: text.optional(),
    pickupFormat: z.enum(["walk-in", "drive-through", "unknown"]).optional(),
    pedestrianPickup: z.enum(["allowed", "not-allowed", "unknown"]).optional(),
    visitFrequency: text.optional(),
    documents: z
      .array(
        z.object({
          name: text,
          requirement: z.enum(["requested", "required", "unknown"]),
        }),
      )
      .optional(),
    languages: z.array(text).optional(),
    accessibility: text.optional(),
    bookingUrl: url.optional(),
    missingInformation: z.array(text).optional(),
  }),
});
/** Defensive reader: browser storage may be outdated or corrupt. Never render invalid snapshots. */
export function isSavedPlan(value: unknown): value is SavedPlan {
  return schema.safeParse(value).success;
}
