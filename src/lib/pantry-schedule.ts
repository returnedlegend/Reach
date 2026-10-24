import { z } from "zod";
import { isDate } from "./time";
import type { PantryWindow } from "./types";
export const pantryDateSchema = z
  .string()
  .refine(isDate, "Use a valid YYYY-MM-DD date.");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z.number().int().min(0).max(6);
const rule = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("weekly"),
      weekdays: z
        .array(day)
        .min(1)
        .max(7)
        .refine((v) => new Set(v).size === v.length),
    })
    .strict(),
  z
    .object({
      kind: z.literal("nth-weekday"),
      weekday: day,
      nth: z.number().int().min(1).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("first-weekdays"),
      weekday: day,
      count: z.number().int().min(1).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("dates"),
      dates: z.array(pantryDateSchema).min(1).max(366),
    })
    .strict(),
]);
export const pantryWindowSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    rule,
    opens: time,
    closes: time,
    registrationOpens: time.optional(),
    registrationCutoff: time.optional(),
    distributionCutoff: time.optional(),
    appointmentRequired: z.boolean().optional(),
    policyKnown: z.boolean(),
    conflictingSources: z.boolean().optional(),
    sourceIds: z.array(z.string().trim().min(1).max(150)).max(20),
  })
  .strict()
  .refine((v) => v.closes > v.opens, "Closing time must follow opening time.")
  .refine(
    (v) =>
      !v.registrationOpens ||
      !v.registrationCutoff ||
      v.registrationCutoff >= v.registrationOpens,
    "Registration cutoff precedes registration opening.",
  )
  .refine(
    (v) =>
      !v.distributionCutoff ||
      (v.distributionCutoff >= v.opens && v.distributionCutoff <= v.closes),
    "Distribution cutoff must be within distribution hours.",
  );
export const pantryHoursSchema = z
  .object({
    windows: z
      .array(pantryWindowSchema)
      .max(50)
      .refine(
        (v) => new Set(v.map((w) => w.id)).size === v.length,
        "Window identifiers must be unique.",
      ),
    closures: z.array(pantryDateSchema).max(366),
    version: z.number().int().positive(),
  })
  .strict();
export function describePantryWindows(
  windows: PantryWindow[],
  closures: string[] = [],
): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  if (!windows.length) return "Distribution hours not verified.";
  const schedule = windows
    .map((w) => {
      const r = w.rule;
      const when =
        r.kind === "weekly"
          ? r.weekdays.map((d) => days[d]).join(", ")
          : r.kind === "nth-weekday"
            ? `${["", "First", "Second", "Third", "Fourth", "Fifth"][r.nth]} ${days[r.weekday]} monthly`
            : r.kind === "first-weekdays"
              ? `First ${r.count} ${days[r.weekday]}s monthly`
              : r.dates.join(", ");
      return `${when}, ${w.opens}–${w.closes}${w.appointmentRequired ? "; appointment required" : ""}${w.conflictingSources ? "; published sources conflict, confirm before visiting" : ""}${!w.policyKnown ? "; pickup policy needs confirmation" : ""}`;
    })
    .join(". ");
  return `${schedule}.${closures.length ? ` Closed ${closures.join(", ")}.` : ""} Published hours do not guarantee food availability.`;
}
