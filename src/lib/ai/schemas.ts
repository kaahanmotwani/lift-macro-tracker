import { z } from "zod";

/**
 * The shapes Claude is required to return. The API *enforces* these, which is
 * what makes the importer reliable — but it also caps schema complexity: at most
 * 16 properties may be union-typed, and every `.nullable()` field is a union
 * (`number | null`).
 *
 * So the convention is:
 *   - Text fields are plain required strings, with "" meaning "not stated".
 *     An empty string is exactly as honest as null — nothing gets invented.
 *   - Numbers stay nullable, because there is no safe sentinel number: 0 is a
 *     real weight (bodyweight) and a real rep count.
 *
 * After parsing, `blanksToNull` turns every "" back into null, so the rest of the
 * app only ever sees null for "unknown". The exported types below describe that
 * post-cleanup shape.
 *
 * Keep the union count at or under 16 — `npm run check:schemas` verifies it.
 */

const text = (description: string) => z.string().describe(`${description} Use "" if not stated.`);

export const SetSegmentSchema = z.object({
  weight_lbs: z
    .number()
    .nullable()
    .describe("Load in POUNDS as written (convert kg). For weighted bodyweight moves like '+44', the added load. null = no added weight / bodyweight."),
  reps: z.number().nullable().describe("Reps; half reps allowed (7.5). null if not stated."),
  note: text("Anything about this segment."),
});

export const LiftSetSchema = z.object({
  is_warmup: z.boolean().describe("True only if called a warmup."),
  rpe: z.number().nullable().describe("RPE 1-10 if stated, else null."),
  note: text("Per-set note: pain, form, side ('L'/'R'), machine setting, original plate count."),
  segments: z
    .array(SetSegmentSchema)
    .describe(
      "One entry for a normal set. Several when one set used several weights in a row, " +
        "e.g. '5 @ 260 + 3 @ 200' or '6 @ +44 + 3 bw' — in the order performed.",
    ),
});

export const LiftExerciseSchema = z.object({
  name: z.string().describe("The movement as the user would recognize it, without grip/angle/gym."),
  equipment: text("barbell | dumbbell | machine | cable | smith | bodyweight | kettlebell | band | other."),
  grip: text("wide | narrow | neutral | supinated | pronated | ..."),
  angle: text("incline | decline | flat | ..."),
  variant: text("Other distinguishing detail: single-arm, long head, rope, D bar, ..."),
  gym: text("Gym name if the user tied this exercise to one (e.g. 'lifetime', 'bay club')."),
  primary_muscles: z.array(z.string()).describe("Main movers, lowercase."),
  secondary_muscles: z.array(z.string()),
  starting_resistance_lbs: z
    .number()
    .nullable()
    .describe("Only if the user stated the machine's starting resistance, else null."),
  unilateral: z.boolean(),
  note: text("Exercise-level note."),
  sets: z.array(LiftSetSchema),
});

export const WorkoutSchema = z.object({
  date: text("YYYY-MM-DD."),
  title: text("e.g. 'Upper pull', 'Legs'."),
  gym: text("Gym for the whole session if stated."),
  notes: text("Session notes: sleep, illness, hangover, injuries, 'quick workout'."),
  exercises: z.array(LiftExerciseSchema).describe("IN THE ORDER PERFORMED."),
});

export const MicronutrientSchema = z.object({
  name: z.string().describe("e.g. 'sodium', 'vitamin D', 'iron'"),
  amount: z.string().describe("With unit, e.g. '480 mg'. Estimates are fine."),
});

export const DietEntrySchema = z.object({
  name: z.string(),
  brand: text("Brand if known."),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack", "unspecified"]),
  qty: z.number().nullable(),
  unit: text("g, oz, cup, serving, slice, ..."),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fiber_g: z.number().nullable(),
  micros: z.array(MicronutrientSchema).describe("Estimated. Users never log these by hand."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("high = user gave numbers; medium = named brand/portion; low = rough guess."),
  note: text("Portion assumption or caveat."),
  saved_ref: text(
    "Ref of the user's saved food or recipe (e.g. 'F3', 'R1') when this entry is one of them.",
  ),
});

export const DietDaySchema = z.object({
  date: text("YYYY-MM-DD."),
  completeness: z
    .enum(["complete", "partial", "untracked"])
    .describe("'partial' if the user said they missed logging something that day."),
  completeness_note: text("What was missed."),
  entries: z.array(DietEntrySchema),
});

export const BodyweightSchema = z.object({
  date: text("YYYY-MM-DD."),
  time: text("HH:MM 24-hour."),
  weight: z.number(),
  unit: z.enum(["lb", "kg"]),
  note: text("Note."),
});

/** What a natural-language import produces. One paste can contain all three. */
export const ImportResultSchema = z.object({
  workouts: z.array(WorkoutSchema),
  diet_days: z.array(DietDaySchema),
  bodyweight: z.array(BodyweightSchema),
  unparsed: z
    .array(z.string())
    .describe("Lines you could not confidently map. Never silently drop content."),
  summary: z.string().describe("One or two sentences on what you found and what you assumed."),
});

/** What a meal photo produces — same entry shape, so it flows into the same writer. */
export const PhotoEstimateSchema = z.object({
  entries: z.array(DietEntrySchema),
  summary: z.string().describe("What you saw and how confident you are in the portions."),
});

/** Daily micronutrient roll-up, generated rather than logged. */
export const MicroSummarySchema = z.object({
  summary: z.string().describe("2-4 sentences in plain language. Note gaps and excesses."),
  notable: z.array(
    z.object({
      name: z.string(),
      amount: z.string(),
      assessment: z.enum(["low", "adequate", "high"]),
    }),
  ),
});

// -----------------------------------------------------------------------------
// Post-parse cleanup: "" → null
// -----------------------------------------------------------------------------

/**
 * The parsed shape with every free-text string widened to `string | null`.
 * Enums (`"lb" | "kg"`) are left alone — they are never blank.
 */
export type Blankable<T> = T extends (infer U)[]
  ? Blankable<U>[]
  : T extends object
    ? { [K in keyof T]: Blankable<T[K]> }
    : string extends T
      ? T | null
      : T;

/** Recursively converts empty/whitespace-only strings to null. */
export function blanksToNull<T>(value: T): Blankable<T> {
  if (typeof value === "string") {
    return (value.trim() === "" ? null : value) as Blankable<T>;
  }
  if (Array.isArray(value)) return value.map(blanksToNull) as Blankable<T>;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, blanksToNull(v)]),
    ) as Blankable<T>;
  }
  return value as Blankable<T>;
}

export type ImportResult = Blankable<z.infer<typeof ImportResultSchema>>;
export type ParsedWorkout = ImportResult["workouts"][number];
export type ParsedDietDay = ImportResult["diet_days"][number];
export type ParsedDietEntry = ParsedDietDay["entries"][number];
/**
 * A diet entry after it has been matched to one of the user's saved foods or
 * recipes (see lib/pantry.ts). The ids are added by the app, never by Claude.
 */
export type LinkedDietEntry = ParsedDietEntry & {
  food_item_id?: string | null;
  recipe_id?: string | null;
};
export type ParsedBodyweight = ImportResult["bodyweight"][number];
export type PhotoEstimate = Blankable<z.infer<typeof PhotoEstimateSchema>>;
export type MicroSummary = Blankable<z.infer<typeof MicroSummarySchema>>;
