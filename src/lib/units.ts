/**
 * Everything in the database is stored in pounds. Conversion happens only at the
 * display/input edges, so there is exactly one canonical number per weight and
 * no rounding drift accumulates across edits.
 */

export const LB_PER_KG = 2.2046226218;

export type WeightUnit = "lb" | "kg";

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

/** Convert a stored (lb) value into the user's display unit. */
export function fromLbs(lb: number, unit: WeightUnit): number {
  return unit === "kg" ? lbToKg(lb) : lb;
}

/** Convert a user-entered value in their display unit back to lb for storage. */
export function toLbs(value: number, unit: WeightUnit): number {
  return unit === "kg" ? kgToLb(value) : value;
}

export function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function formatWeight(lb: number | null | undefined, unit: WeightUnit): string {
  if (lb === null || lb === undefined || Number.isNaN(lb)) return "—";
  return `${round(fromLbs(lb, unit), 1)} ${unit}`;
}

/** Weight for display without the unit suffix (for table cells). */
export function weightValue(lb: number | null | undefined, unit: WeightUnit): string {
  if (lb === null || lb === undefined || Number.isNaN(lb)) return "BW";
  return String(round(fromLbs(lb, unit), 1));
}

// -----------------------------------------------------------------------------
// Dates. We deliberately use plain 'YYYY-MM-DD' strings everywhere rather than
// Date objects: a workout on the 3rd is on the 3rd regardless of timezone, and
// `new Date("2026-07-03")` silently means midnight UTC, which is the 2nd in
// California. String dates make that class of bug impossible.
// -----------------------------------------------------------------------------

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...opts,
  });
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

// -----------------------------------------------------------------------------
// Training math
// -----------------------------------------------------------------------------

/**
 * Estimated one-rep max (Epley). Used only as a *comparable* number across
 * sessions — "am I getting stronger?" is easier to answer with one series than
 * with a scatter of weight×rep pairs. It is not a prediction of a real 1RM.
 */
export function epley1RM(weightLbs: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightLbs;
  return weightLbs * (1 + reps / 30);
}

/** Calories implied by macros, when the source didn't state them. */
export function kcalFromMacros(p?: number | null, c?: number | null, f?: number | null): number {
  return (p ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9;
}

/** Default protein target: 0.8 g per pound of bodyweight. */
export function defaultProteinTarget(bodyweightLbs: number, multiplier = 0.8): number {
  return Math.round(bodyweightLbs * multiplier);
}

/** Normalizes a free-text name into a dedupe key so imports don't create twins. */
export function matchKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
