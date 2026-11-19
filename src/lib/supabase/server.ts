import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseKey, supabaseUrl } from "./env";

/**
 * Supabase client for React Server Components, server actions, and route
 * handlers. It reads the session from cookies, so every query it issues runs as
 * the signed-in user — which means Row Level Security applies. There is no
 * service-role key anywhere in this app: the database enforces isolation, not
 * our `where` clauses.
 */
export async function getSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl(),
    supabaseKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function getUser() {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user, or a redirect to /login. Use this in every private page. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export type Profile = {
  id: string;
  display_name: string | null;
  weight_unit: "lb" | "kg";
  anthropic_key_ciphertext: string | null;
  anthropic_key_hint: string | null;
  model: string;
  /** Missing until the database update that adds it has been run. */
  auto_remember_foods?: boolean;
};

export async function getProfile(): Promise<Profile | null> {
  const supabase = await getSupabase();
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
}
