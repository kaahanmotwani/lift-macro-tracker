import { z } from "zod";

/**
 * The shapes Claude is required to return. These are the contract between "some
 * text a human typed into the Notes app" and our database — and they're the
 * reason the importer is reliable: the model is *constrained* to this schema
 * rather than asked nicely to produce JSON.
 *
 * Everything is `.nullable()` rather than `.optional()` on purpose. The
 * structured-output engine handles a required-but-nullable field far more
 * predictably than an absent one, and "the user didn't say" is real information
 * we want to keep — an unstated weight becomes null, not a guess.
 */

export const SetSegmentSchema = z.object({
  weight_lbs: z
    .number()
    .nullable()
    .describe("Weight in POUNDS as written on the plates/pin. null for bodyweight."),
  reps: z.number().int().nullable(),
  note: z.string().nullable(),
});

export const LiftSetSchema = z.object({
  is_warmup: z.boolean().describe("True only if explicitly called a warmup."),
  rpe: z.number().nullable().describe("Rate of perceived exertion 1-10, if stated."),
  note: z.string().nullable().describe("Anything about this specific set: pain, form, failure."),
  segments: z
    .array(SetSegmentSchema)
    .describe(
      "One entry for a normal set. MULTIPLE entries when a single set was performed at " +
        "more than one weight, e.g. '3 reps @ 50lb + 2 reps @ 30lb' is two segments.",
    ),
});

export const LiftExerciseSchema = z.object({
  name: z.string().describe("The movement name as the user would recognize it."),
  equipment: z
    .string()
    .nullable()
    .describe("barbell | dumbbell | machine | cable | smith | bodyweight | band | other"),
  grip: z.string().nullable().describe("wide | narrow | neutral | pronated | supinated | ..."),
  angle: z.string().nullable().describe("incline | decline | flat | 45 degree | ..."),
  variant: z.string().nullable().describe("Any other distinguishing detail (single-arm, paused)."),
  gym: z.string().nullable().describe("Gym or machine brand, if the user named one."),
  primary_muscles: z.array(z.string()).describe("Main movers, lowercase, e.g. ['chest']."),
  secondary_muscles: z.array(z.string()),
  starting_resistance_lbs: z
    .number()
    .nullable()
    .describe("Only if the user stated the machine's baseline resistance."),
  unilateral: z.boolean(),
  note: z.string().nullable(),
  sets: z.array(LiftSetSchema),
});

export const WorkoutSchema = z.object({
  date: z.string().nullable().describe("YYYY-MM-DD. null if the text gave no date."),
  title: z.string().nullable().describe("e.g. 'Push day'."),
  gym: z.string().nullable(),
  notes: z.string().nullable(),
  exercises: z
    .array(LiftExerciseSchema)
    .describe("IN THE ORDER PERFORMED — assume written order is performed order."),
});

export const MicronutrientSchema = z.object({
  name: z.string().describe("e.g. 'sodium', 'vitamin D', 'iron'"),
  amount: z.string().describe("Include the unit, e.g. '480 mg'. Estimates are fine."),
});

export const DietEntrySchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack", "unspecified"]),
  qty: z.number().nullable(),
  unit: z.string().nullable().describe("g, oz, cup, serving, slice, ..."),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fiber_g: z.number().nullable(),
  micros: z.array(MicronutrientSchema).describe("Estimated. Users never log these by hand."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("high = user gave numbers; medium = named brand/portion; low = rough guess."),
  note: z.string().nullable(),
});

export const DietDaySchema = z.object({
  date: z.string().nullable().describe("YYYY-MM-DD"),
  completeness: z
    .enum(["complete", "partial", "untracked"])
    .describe("'partial' if the user said they missed logging something that day."),
  completeness_note: z.string().nullable(),
  entries: z.array(DietEntrySchema),
});

export const BodyweightSchema = z.object({
  date: z.string().nullable().describe("YYYY-MM-DD"),
  time: z.string().nullable().describe("HH:MM 24-hour, if stated."),
  weight: z.number(),
  unit: z.enum(["lb", "kg"]),
  note: z.string().nullable(),
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

export type ImportResult = z.infer<typeof ImportResultSchema>;
export type ParsedWorkout = z.infer<typeof WorkoutSchema>;
export type ParsedDietDay = z.infer<typeof DietDaySchema>;
export type ParsedDietEntry = z.infer<typeof DietEntrySchema>;
export type ParsedBodyweight = z.infer<typeof BodyweightSchema>;

/** What a meal photo produces — same entry shape, so it flows into the same writer. */
export const PhotoEstimateSchema = z.object({
  entries: z.array(DietEntrySchema),
  summary: z.string().describe("What you saw and how confident you are in the portions."),
});
export type PhotoEstimate = z.infer<typeof PhotoEstimateSchema>;

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
export type MicroSummary = z.infer<typeof MicroSummarySchema>;
