"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./env";

/**
 * Browser-side client. Used only for auth (sign-in, sign-out) and photo uploads
 * that go straight to Storage. All data reads/writes go through server actions
 * so the query logic lives in one place.
 */
export function createClient() {
  return createBrowserClient(
    supabaseUrl(),
    supabaseKey(),
  );
}
