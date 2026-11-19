/**
 * Supabase connection settings, read in one place.
 *
 * The URL is normalized because Supabase's own dashboard shows it in two forms:
 * the bare project URL (`https://xyz.supabase.co`) and, on some pages, the REST
 * endpoint (`https://xyz.supabase.co/rest/v1/`). The client library appends its
 * own paths, so pasting the second form sends sign-in requests to
 * `/rest/v1/auth/v1/...` and every one fails with "Invalid path specified in
 * request URL". Accepting both forms removes that trap for anyone self-hosting.
 *
 * The `process.env.NEXT_PUBLIC_...` references must stay written out literally:
 * Next.js inlines NEXT_PUBLIC_ variables into the browser bundle by finding
 * those exact expressions at build time.
 */

export function supabaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. See DEPLOY.md, step 2.");
  }
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage)\/v1$/, "");
}

export function supabaseKey(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. See DEPLOY.md, step 2.");
  }
  return raw.trim();
}
