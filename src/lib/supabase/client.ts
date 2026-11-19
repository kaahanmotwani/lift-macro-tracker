"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side client. Used only for auth (sign-in, sign-out) and photo uploads
 * that go straight to Storage. All data reads/writes go through server actions
 * so the query logic lives in one place.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
