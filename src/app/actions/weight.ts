"use server";

import { revalidatePath } from "next/cache";
import { getProfile, getSupabase, requireUser } from "@/lib/supabase/server";
import { toLbs, todayISO } from "@/lib/units";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Bodyweight logging. The number the user types is in whatever unit they've
 * chosen; we convert to pounds on the way in so there is one canonical value in
 * the database and unit switching never rewrites history.
 */
export async function logBodyweight(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const profile = await getProfile();

  const raw = str(fd, "weight");
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return;

  // Entry-time unit override, so you can log one reading in kg without
  // changing your whole account preference.
  const unit = (str(fd, "unit") ?? profile?.weight_unit ?? "lb") as "lb" | "kg";
  const date = str(fd, "date") ?? todayISO();
  const time = str(fd, "time");

  await supabase.from("bodyweight_logs").insert({
    user_id: user.id,
    date,
    // Time of day is optional — a weight with no time is still a useful weight.
    logged_at: time ? new Date(`${date}T${time}:00`).toISOString() : null,
    weight_lbs: toLbs(value, unit),
    note: str(fd, "note"),
  });

  revalidatePath("/weight");
  revalidatePath("/");
}

export async function updateBodyweight(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const profile = await getProfile();
  const id = str(fd, "id");
  if (!id) return;

  const raw = str(fd, "weight");
  const unit = (str(fd, "unit") ?? profile?.weight_unit ?? "lb") as "lb" | "kg";
  const date = str(fd, "date");
  const time = str(fd, "time");

  const patch: Record<string, unknown> = { note: str(fd, "note") };
  if (raw && Number.isFinite(Number(raw))) patch.weight_lbs = toLbs(Number(raw), unit);
  if (date) {
    patch.date = date;
    patch.logged_at = time ? new Date(`${date}T${time}:00`).toISOString() : null;
  }

  await supabase.from("bodyweight_logs").update(patch).eq("id", id);
  revalidatePath("/weight");
  revalidatePath("/");
}

export async function deleteBodyweight(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("bodyweight_logs").delete().eq("id", id);
  revalidatePath("/weight");
}
