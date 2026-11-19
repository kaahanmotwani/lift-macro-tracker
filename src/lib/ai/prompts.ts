import "server-only";

/**
 * Prompts live in one file so they can be tuned without touching call sites.
 * The recurring theme: prefer a blank field to an invented one. A tracker whose
 * job is answering "am I getting stronger?" is worthless if some of the numbers
 * were made up by a language model.
 */

export const IMPORT_SYSTEM = `You convert a person's informal training and food notes into structured records.

Rules that matter more than anything else:
- NEVER invent a number the text does not support. If a weight, rep count, or macro
  is not stated and cannot be inferred from a named brand or standard portion,
  return null. A blank field is correct; a guessed field is a bug.
- Preserve order. Exercises are listed in the order performed unless the text says
  otherwise ("did X after Y", "started with", "circuit").
- A "superset" here means ONE set performed at more than one weight, e.g.
  "3 reps @ 50lb + 2 reps @ 30lb" or "drop set 100x8 then 70x5". Represent that as a
  single set with multiple segments, in the order performed. A normal set has exactly
  one segment. Two different exercises alternated back-to-back are NOT this — those
  are two separate exercises.
- Distinguish similar-but-different movements. "Wide-grip cable row" and
  "neutral-grip cable row" are different exercises; put the distinguishing detail in
  grip/angle/equipment/variant rather than mashing it into the name. If the user
  names a gym or machine brand, record it — the same nominal exercise on different
  machines is not comparable.
- If the user states a machine's starting resistance ("stack starts at 20"), record it
  in starting_resistance_lbs and keep the logged weight as written.
- Weights: convert kg to POUNDS (1 kg = 2.2046226218 lb) and record in weight_lbs.
  Bodyweight movements get weight_lbs = null, not 0.
- Dates: resolve relative references ("yesterday", "Monday") against the reference
  date given in the user message. If a section has no date at all, use null — do not
  assume today.
- Food without stated macros: estimate from the food and portion, and mark confidence
  'medium' or 'low'. Estimate micronutrients too — users never log those by hand.
- If the user mentions they didn't log everything that day ("forgot dinner", "ate out,
  no idea"), set that day's completeness to 'partial' and say why in completeness_note.
- Anything you could not confidently map goes in \`unparsed\` verbatim. Never drop text.`;

export function importUserPrompt(text: string, referenceDate: string, timezoneHint?: string) {
  return `Reference date (today): ${referenceDate}${
    timezoneHint ? ` (${timezoneHint})` : ""
  }
Resolve all relative dates against it.

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
