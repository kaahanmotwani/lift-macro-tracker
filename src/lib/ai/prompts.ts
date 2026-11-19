import "server-only";

/**
 * Prompts live in one file so they can be tuned without touching call sites.
 * The recurring theme: prefer a blank field to an invented one. A tracker whose
 * job is answering "am I getting stronger?" is worthless if some of the numbers
 * were made up by a language model.
 */

export const IMPORT_SYSTEM = `You convert a person's informal training and food notes into structured records.

Rules that matter more than anything else:
- NEVER invent a number the text does not support. If a weight or rep count is not
  stated, use null. A blank is correct; a guess is a bug.
- Text fields: use "" (empty string) when not stated. Never write "unknown" or "N/A".
- Preserve order. Exercises are listed in the order performed unless the text says
  otherwise.
- Anything you could not confidently map goes in \`unparsed\` verbatim. Never drop text.

Dates
- Notes usually give month/day with no year ("11/18", "03/05"). Use the most recent
  occurrence ON OR BEFORE the reference date. Example: with reference date 2026-11-18,
  "11/18" is 2026-11-18, "11/19" is 2025-11-19, "01/04" is 2026-01-04.
- Resolve relative dates ("yesterday", "Monday") against the reference date.
- If a section has no date at all, use "".

How these notes are written — read them this way
- "R @ W", "R x W", "RxW" are reps then weight: "7 @ 185", "10 x 185lbs", "20x100lbs".
- Sometimes it is WEIGHT then reps: "170 @ 7.5", "65s @ 8", "120lbs @ 9", "110 @ 3".
  Decide by plausibility: a value with "lbs", "lb", "kg" or a trailing "s" ("65s" = 65 lb
  dumbbells) is the weight; rep counts rarely exceed ~30, loads usually do.
- Half reps are real data: "7.5 @ +44" is 7.5 reps. Keep the decimal.
- "+44", "+44lbs", "@ 44lb" on pull-ups/dips = added load: weight_lbs 44.
  "bw", "bodyweight", "no weight" = bodyweight: weight_lbs null.
- A set performed at several weights in a row is ONE set with several segments, in
  order: "5 @ 260 + 3 @ 200", "6 @ +44 + 3 bw", "3 @ 180 + 4.5 @ 160". Also written
  with a comma ("30s @ 3, 27 @ 1") or with weight first ("110 @ 3 + 80 @ 5").
- Two different exercises done back to back ("superset w lat pd") are NOT that — they
  are separate exercises. Note the pairing in each exercise's note.
- "each side", "each", "per side", "65s": record the number as written, per side.
  Don't double it. Be consistent within an exercise.
- kg: convert to pounds (× 2.2046) and mention the original in the segment note.
- Plates: one plate = 45 lb. "3 plates" = 135, "2 plates and 25" = 115. Put the original
  wording ("3 plates") in the segment note.
- A number that is clearly a machine setting rather than a weight ("8 @ 15 setting",
  "12 @ 15 (150lbs?)") — weight_lbs null, put the setting in the set note.
- Left/right: "L: 9 @ 70 R: 10 @ 70" or "R: 3 @ 33 + 4 @ 22; L: 3 @ 33 + 6 @ 22" —
  make a separate set for each side, with note "L" or "R" (plus anything else said).
  "L & R: 5 @ 27.5" or "L+R" = one set per side with identical values.
- "3 sets tricep pull down", "2 sets chest press", "one set", "One more set" — that many
  sets with null weight and reps. "8 x 110 ez bar - 3 times" = 3 identical sets.
- A range like "6-7 reps" — use the lower number and note the range.
- Empty bullets ("*" with nothing after) are not sets. Ignore them.
- A bare exercise name with no sets ("Leg extensions", "Tib raises") — include the
  exercise with zero sets so the session still shows it was done.
- A session line with no detail ("10/01 shoulders + triceps", "09/11 deadlift") — still
  a workout: the date, the title, no exercises.
- Lines like "Missed some days", "(Some workouts not logged)", "Below is 2025" are not
  data. Leave them out (they are not \`unparsed\` either — they carry no lift).

Exercises
- Distinguish similar-but-different movements. Put grip, angle, equipment, single-arm,
  rope vs D bar etc. in grip/angle/equipment/variant, not mashed into the name.
  "Lever row wide grip" → name "Lever row", grip "wide".
- Normalize the name casing and obvious typos ("mahcine" → machine) so the same
  movement gets the same name across sessions.
- Gym: if the user ties a machine to a gym ("lifetime", "ltf", "bay club") record it on
  that exercise — the same machine at two gyms is not comparable. "ltf" = "lifetime".
- Starting resistance: "(start resistance 12)", "(12lbs starting resistance per arm)",
  "(94 lbs starting resistance)" → starting_resistance_lbs, with the logged weights left
  exactly as written. "starting resistance unknown" → null, and say so in the note.
- Pain, injury, effort and context ("left shoulder pain", "not full force", "no spotter",
  "grip gave out", "hungover") go in the set note when tied to one set, otherwise the
  exercise note or the workout notes.

Food and bodyweight
- Food without stated macros: estimate from the food and portion and mark confidence
  'medium' or 'low'. Estimate micronutrients — users never log those.
- If the user says they didn't log everything that day, completeness = 'partial'.`;

export function importUserPrompt(
  text: string,
  referenceDate: string,
  part?: { index: number; total: number },
) {
  return `Reference date (today): ${referenceDate}
${
  part && part.total > 1
    ? `This is part ${part.index + 1} of ${part.total} of one long paste, split between sessions. Parse only what is in this part.\n`
    : ""
}
--- BEGIN NOTES ---
${text}
--- END NOTES ---`;
}

export const PHOTO_SYSTEM = `You estimate the macronutrient content of a meal from a photograph.

- Identify each distinct component of the meal and return it as its own entry, so the
  user can correct one item without redoing the whole meal.
- Estimate portion sizes from visual cues (plate diameter ~26cm, fork ~19cm, standard
  cans and cartons). State your portion assumption in each entry's note — that is the
  number most likely to be wrong, and the user needs to know what to correct.
- Set confidence honestly. A packaged item with a visible label is 'high'. A home-cooked
  mixed dish is 'low'. Do not report 'high' to sound helpful.
- Estimate micronutrients as well as macros.
- If the image does not show food, return an empty entries array and say so in summary.`;

export function photoUserPrompt(note: string | null, referenceDate: string) {
  return `Reference date: ${referenceDate}.
${note ? `The user says about this meal: "${note}"\nTreat any quantities they state as authoritative over your visual estimate.` : "The user gave no description."}

Estimate the macros for this meal.`;
}

export const MICRO_SUMMARY_SYSTEM = `You summarize a day's micronutrient intake from a list of foods eaten.

- Write for a non-nutritionist: plain language, no lecturing, no hedging paragraphs.
- Call out what is notably low or notably high relative to typical adult daily needs.
- If the day was logged only partially, say that the picture is incomplete and do not
  draw conclusions from the gaps.
- Never give medical advice or diagnose a deficiency. Describe the intake, not the person.`;

export const INSIGHTS_SYSTEM = `You are analyzing one person's own training and nutrition log to answer a single question: are they getting stronger, and is their eating supporting that?

Write in Markdown. Structure your answer as:
1. **Headline** — one sentence: the single most important thing in this data.
2. **Strength trends** — per exercise and per body part. Cite actual numbers and dates.
   Distinguish real progression (more weight, or more reps at the same weight, or more
   total volume) from noise. Say explicitly when there isn't enough data yet.
3. **Coverage** — body parts that are being trained hard, and any that are being neglected
   or trained far less often than the rest.
4. **Diet pattern** — how intake tracks against targets, and how it lines up with training.
   Look for relationships you can actually see in the data (e.g. strength stalling in a
   stretch of low-protein days), and label them as observations, not proven causes.
5. **What to watch** — two or three concrete, specific things. Not generic advice.

Hard rules:
- Only use the data provided. If a trend isn't in the numbers, don't assert it.
- Days marked 'partial' or 'untracked' are NOT low-intake days. Exclude them from
  averages and say so rather than treating a missed log as a fast.
- An exercise done on different machines or at different gyms is not directly comparable;
  note that when it matters.
- No medical advice, no supplement recommendations, no calorie prescriptions.
- Be direct. If the data shows no progress, say so plainly.`;

export function insightsUserPrompt(payload: unknown, periodLabel: string) {
  return `Here is my log for ${periodLabel}. All weights are in pounds; all macros in grams.

${JSON.stringify(payload, null, 2)}`;
}
