"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { encryptSecret, keyHint } from "@/lib/crypto";
import type { ActionResult } from "@/lib/types";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Actions bound with <ActionForm> receive the previous result as their first
 * argument — that's how useActionState invokes them. The value is unused here;
 * each submit is independent.
 */
export async function saveProfile(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await getSupabase();

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: str(fd, "display_name"),
      weight_unit: str(fd, "weight_unit") === "kg" ? "kg" : "lb",
      model: str(fd, "model") ?? "claude-opus-5",
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, message: "Preferences saved." };
}

/**
 * Stores the user's own Anthropic API key, encrypted. We verify it works before
 * saving — a key that silently fails at 11pm when you're trying to import a
 * workout is a worse experience than a rejection here.
 */
export async function saveApiKey(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const key = str(fd, "api_key");

  if (!key) return { ok: false, error: "Paste your Anthropic API key first." };
  if (!key.startsWith("sk-ant-")) {
    return { ok: false, error: "That doesn't look like an Anthropic key — they start with 'sk-ant-'." };
  }

  try {
    const probe = new Anthropic({ apiKey: key });
    await probe.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4,
      messages: [{ role: "user", content: "hi" }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "Anthropic rejected that key. Check it and try again." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Could not verify the key: ${error.message}` };
    }
    return { ok: false, error: "Could not reach Anthropic to verify the key." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      anthropic_key_ciphertext: encryptSecret(key),
      anthropic_key_hint: keyHint(key),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Key verified and saved." };
}

export async function removeApiKey(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ anthropic_key_ciphertext: null, anthropic_key_hint: null })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Key removed." };
}

/**
 * Exports everything this user has ever logged as JSON. Their data, their copy —
 * a tracker you can't get your history out of is a trap.
 */
export async function exportEverything(): Promise<ActionResult<string>> {
  await requireUser();
  const supabase = await getSupabase();

  const tables = [
    "profiles",
    "exercises",
    "workouts",
    "workout_exercises",
    "workout_sets",
    "set_segments",
    "food_items",
    "recipes",
    "recipe_items",
    "diet_days",
    "diet_entries",
    "targets",
    "bodyweight_logs",
    "insights",
  ] as const;

  const dump: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) return { ok: false, error: `${table}: ${error.message}` };
    // Never export the encrypted key blob, even to its owner.
    dump[table] =
      table === "profiles"
        ? (data ?? []).map(({ anthropic_key_ciphertext, ...rest }) => rest)
        : data;
  }

  return { ok: true, data: JSON.stringify(dump, null, 2) };
}
