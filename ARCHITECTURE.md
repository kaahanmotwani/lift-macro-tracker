# Architecture

Written for someone who studied CS but doesn't write code daily. Each section is a decision, the alternatives, and why this one won.

---

## The shape of the thing

```
   iPhone home screen icon
            │
            ▼
   ┌──────────────────┐      ┌──────────────────────┐
   │  Next.js app     │◄────►│  Supabase            │
   │  (on Vercel)     │      │  Postgres + Auth     │
   │                  │      │  + file storage      │
   │  UI + server     │      └──────────────────────┘
   │  logic together  │
   └────────┬─────────┘
            │  user's own API key
            ▼
   ┌──────────────────┐
   │  Anthropic API   │  parsing, photo estimates, insights
   └──────────────────┘
```

Three services, one codebase. There is no separate backend to deploy and no API layer to keep in sync with the frontend.

---

## 1. Why one app instead of a frontend and a backend

The classic split is a React frontend calling a REST or GraphQL backend. That's two deployments, two sets of types, and an API surface you have to design, version, and document — and every new feature touches all three layers.

Next.js **server components and server actions** collapse that. A page runs on the server, queries the database directly, and streams HTML to the phone. A form posts to a function that also runs on the server. There's no JSON API in between because there are no two separate programs to connect.

**What you give up:** if you later want a native iOS app or a public API, you'd have to build one. For a single-user-per-account tracker, that trade is clearly right — and if it changes, the data model doesn't.

**A real benefit that surprised me:** because every mutation is a plain HTML `<form>`, the app works before its JavaScript loads. On gym wifi, tapping "save set" works on a half-loaded page. That falls out of the architecture rather than being engineered.

---

## 2. Why Postgres, and why the database enforces privacy

This data is deeply relational — a workout has exercises, which have sets, which have segments; a day has entries, which reference saved foods. Questions like "show me every set of wide-grip rows in the last 90 days with the machine's base weight added" are one SQL query and would be an application-level loop in a document database.

The more important decision is **Row Level Security**. Every table has a policy:

```sql
create policy exercises_owner on public.exercises
  for all using (auth.uid() = user_id);
```

This means the *database* refuses to return another user's rows, regardless of what the application asks for. The usual approach is `WHERE user_id = ?` in application code — which works until the one query where somebody forgets it, and that single omission is a data breach.

Concretely: this app never uses Supabase's `service_role` key, the one that bypasses RLS. Every query runs as the signed-in user. A bug in my query code can return *no* data or *wrong-shaped* data; it cannot return *someone else's* data.

**The cost:** RLS policies are easy to get wrong in the other direction (locking yourself out), and they add a small amount of per-query overhead. Worth it.

---

## 3. The data model decisions that matter

Most of this schema is unremarkable. Four choices carry real weight.

### Sets have *segments*

A superset or drop set — "3 reps at 50 lb, then 2 at 30" — is **one set performed at multiple weights**. The obvious modeling shortcut is to store it as two sets. That's wrong in a way that quietly corrupts the analysis: it inflates your set count, and it makes a hard drop set look like two easy sets.

So the hierarchy is `workout → exercise block → set → segment`, where a normal set has exactly one segment. Slightly more machinery; the numbers stay true.

### Similar exercises are different exercises

"Cable row" isn't one thing. Wide grip and neutral grip load differently. The machine at your gym and the one at the hotel gym aren't comparable. If those all collapse into one row in the database, the progression chart is noise.

Each exercise carries `grip`, `angle`, `equipment`, `variant`, and `gym`, and its dedupe key (`match_key`) is built from **all** of them. That's what stops the AI importer from creating near-duplicates on one hand, or silently merging two genuinely different machines on the other.

### Machines have a starting resistance

A stack that starts at 20 lb means the pin at "50" is really 70. `starting_resistance_lbs` lives on the exercise, the logged weight stays as written on the machine, and charts add the two. You enter what you see; the math stays honest.

### A missing log is not a zero

This is the one I'd defend hardest. If you forget to log dinner, a naive tracker records 900 calories that day, and now your 30-day average is wrong, your trend line is wrong, and the AI analysis confidently explains a "deficit" that never happened.

So days carry a `completeness` field — `complete`, `partial`, or `untracked`. Partial and untracked days are **excluded from averages**, drawn as gaps or faded bars rather than short ones, and passed to the AI in a separate labelled bucket with an instruction not to average them in. It costs one column and buys the analytics their credibility.

### Everything is stored in pounds

Unit conversion happens only at the display and input edges. One canonical number per weight means switching between lb and kg never rewrites history and never accumulates rounding drift. Same reasoning for dates: they're plain `'YYYY-MM-DD'` strings, never `Date` objects, because `new Date("2026-07-03")` is midnight UTC — which is July 2nd in California, and that class of bug is endless.

---

## 4. How the AI is used (and constrained)

Three jobs: parse messy notes, estimate macros from a photo, and analyze trends.

### Structured outputs, not "please return JSON"

The parser doesn't ask Claude to produce JSON and hope. It passes a schema (defined in Zod, [`src/lib/ai/schemas.ts`](src/lib/ai/schemas.ts)) that the API **enforces**. The response is guaranteed to match the shape, so there's no defensive parsing, no "sometimes it wraps the JSON in a code fence," no retry loop.

### Blank beats guessed

The prompt's first rule is that an unstated number stays `null`. Every field is nullable by design. A tracker whose purpose is answering "am I getting stronger" is worse than useless if some of the numbers were invented by a language model to fill a field.

### Propose, then confirm

Imports are two steps: parse → **review screen** → apply. Claude never writes to your log directly. On the review screen you see every set and every meal exactly as it would be stored, with a checkbox per section. Lines it couldn't map are shown verbatim rather than dropped.

The raw text is stored permanently alongside the parse, so a bad import can be re-run without retyping.

### Each user brings their own key

Users paste an Anthropic API key into Settings. It's encrypted with AES-256-GCM ([`src/lib/crypto.ts`](src/lib/crypto.ts)) using a server-side master key, and decrypted only in memory, only for that user's own request.

Why: whoever deploys this pays nothing regardless of how many people use it, there's no rate limit to invent or enforce, and there's no shared quota to abuse. The cost is one extra onboarding step, which the Settings page walks through.

Why encrypted rather than plain text: a Postgres column is readable by anyone with the database password or a backup file. Encrypting means a leaked database dump doesn't leak everyone's API keys.

---

## 5. Charts without a charting library

There are four chart shapes in this app. A library would have been faster to start with, but the requirement that killed it was **"untracked days must not look like zero days."** Off-the-shelf charts model a missing point as either 0 or a hole; expressing "logged, but incomplete" as a distinct third state means fighting the library.

So the charts are hand-written SVG ([`src/components/charts.tsx`](src/components/charts.tsx)): ~400 lines, no dependency, no React-version churn, and full control over the one thing that actually matters here.

Colors come from a validated categorical palette — the four macro colors were chosen to stay distinguishable under color blindness, not picked by eye. Single-series charts all use the same color so it means one thing across the app. Every chart also ships a **"View as table"** disclosure, so the data is readable without seeing color at all.

---

## 6. Why a web app instead of a native iOS app

You wanted a home-screen icon. You don't need Swift to get one.

Add to Home Screen gives a full-screen app with its own icon and no browser chrome. In daily use it's indistinguishable from a native app. Meanwhile: one codebase instead of two, no App Store review on every change, no $99/year developer account, no waiting a week to ship a fix, and it works on Android and desktop for free.

**What you actually give up:** push notifications on iOS are limited, there's no HealthKit or Apple Watch integration, and offline support requires deliberate work (this app doesn't do it yet — see below). If you later want Watch integration, that's the point to reconsider — and the API-less architecture is the thing you'd need to revisit first.

---

## 7. Honest limitations

- **No offline mode.** The app needs a connection. Adding a service worker with an offline write queue is the natural next step, and the form-based architecture makes it tractable, but it isn't there today.
- **Insights are regenerated, not incremental.** Each analysis re-reads the window from scratch. Fine at this scale; at years of data you'd want to cache summaries per period.
- **The importer is as good as your notes.** It won't invent detail, which means genuinely ambiguous notes come back with blanks. That's the correct behavior, but it does mean sloppy notes need manual cleanup.
- **`exerciseHistory` runs one query per exercise** on the workout page. Fine for six exercises; if a session ever had fifty, that page would want a single batched query instead.
- **Refusal fallbacks aren't wired up.** Claude can decline a request; this app surfaces that as a clear error rather than automatically retrying on a second model. For fitness and food data, refusals should be vanishingly rare — but if you ever see one, that's what happened.

---

## 8. If you want to change something

| You want to… | Look at |
|---|---|
| Change what the AI extracts | [`src/lib/ai/schemas.ts`](src/lib/ai/schemas.ts) — the Zod schemas *are* the contract |
| Change how the AI behaves | [`src/lib/ai/prompts.ts`](src/lib/ai/prompts.ts) — all prompts in one file |
| Add a field to the database | [`supabase/schema.sql`](supabase/schema.sql), then the matching type in `src/lib/types.ts` |
| Change a calculation | [`src/lib/units.ts`](src/lib/units.ts) (conversions, 1RM) and [`src/lib/data.ts`](src/lib/data.ts) (aggregations) |
| Change how something looks | `src/components/ui.tsx` for primitives, `src/app/globals.css` for the color tokens |
| Add a page | A folder under `src/app/`, plus a tab in `src/components/nav.tsx` |
