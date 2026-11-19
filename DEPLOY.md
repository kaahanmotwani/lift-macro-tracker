# Running your own copy

This guide assumes you've never deployed anything. It takes about 20 minutes and costs nothing on the free tiers.

You'll create three accounts:

| Service | Does what | Cost |
|---|---|---|
| **Supabase** | Stores your data and handles sign-in | Free |
| **Vercel** | Runs the website | Free |
| **Anthropic** | Powers the AI features | Pay-as-you-go, a few cents per import |

You don't need to install anything or write any code.

---

## 1. Create the database (Supabase)

1. Go to **[supabase.com](https://supabase.com)** and sign up.
2. Click **New project**. Give it any name, pick a strong database password (save it somewhere; you won't need it often), and choose the region closest to you.
3. Wait ~2 minutes for it to finish setting up.
4. In the left sidebar, click **SQL Editor** → **New query**.
5. Open [`supabase/schema.sql`](supabase/schema.sql) in this repository, copy **all** of it, paste it into the editor, and click **Run**. You should see "Success. No rows returned."
6. In the left sidebar, click **Project Settings** (the gear) → **API Keys**. Keep this tab open — you need two values:
   - **Project URL** — just `https://<something>.supabase.co`. Some Supabase pages show it with `/rest/v1/` on the end; the app tolerates that, but the bare form is correct.
   - **Publishable key** (starts `sb_publishable_`). Older projects call it the **anon public** key instead (a long `eyJ…` string) — either works.

   > Never use the **Secret** / **service_role** key here. It bypasses Row Level Security.

> The `anon` key is meant to be public. What protects your data is Row Level Security, which the schema you just ran turns on for every table.

---

## 2. Deploy the website (Vercel)

1. Fork this repository to your own GitHub account (button at the top right of the GitHub page).
2. Go to **[vercel.com](https://vercel.com)** and sign up **with GitHub**.
3. Click **Add New → Project**, find your fork, and click **Import**.
4. Before clicking Deploy, expand **Environment Variables** and add these three:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | The Project URL from step 1.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable (or anon public) key from step 1.6 |
   | `APP_ENCRYPTION_KEY` | See below |

   For `APP_ENCRYPTION_KEY`, you need 32 random bytes. On a Mac, open Terminal and run:

   ```bash
   openssl rand -base64 32
   ```

   Copy the whole output (it ends with `=`). If you'd rather not open a terminal, any "random 32 byte base64 generator" will do — just don't reuse a value from a public example.

   > Keep this value. It encrypts the Anthropic API keys people store in the app. If you change it later, everyone has to re-enter theirs.

5. Click **Deploy**. After a couple of minutes you'll get a URL like `your-app.vercel.app`.

---

## 3. Turn on sign-in

Supabase needs to know your site's address before it will let people log in.

1. In Supabase, go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to your Vercel URL (e.g. `https://your-app.vercel.app`).
3. Under **Redirect URLs**, add:
   ```
   https://your-app.vercel.app/auth/callback
   ```
4. Click **Save**.

Email sign-in links now work. **Google sign-in is optional** — if you want it, go to **Authentication → Providers → Google** in Supabase and follow its instructions; if you skip it, the Google button simply won't work and email links still will.

> Supabase's built-in email sender is rate-limited and fine for a handful of people. If you're inviting a real group, connect your own SMTP under **Authentication → Emails**.

---

## 4. Add your Anthropic key

Open your app, sign in, and go to **Settings**.

1. Create an account at **[console.anthropic.com](https://console.anthropic.com)**.
2. Add some credit under **Billing** — $5 goes a long way.
3. Go to **API Keys**, create one, and copy it (it starts with `sk-ant-`). You only get to see it once.
4. Paste it into Settings in the app and click **Verify & save**. It makes one tiny test call to confirm the key works before storing it.

Each person who uses your instance adds their own key, so you're never paying for anyone else's usage.

---

## 5. Put it on your phone

1. Open your site in **Safari** on your iPhone.
2. Tap the **Share** button (square with an arrow).
3. Tap **Add to Home Screen**.

It gets its own icon and opens full-screen with no browser bar — indistinguishable from an App Store app in daily use.

On Android: Chrome menu → **Install app**.

---

## What it costs

| | |
|---|---|
| Supabase free tier | 500 MB database, 1 GB file storage. A few years of daily logging is well under that. |
| Vercel free tier | Plenty for personal use. |
| Anthropic | Pay per use — depends on the model you pick in Settings (below). |

### AI cost by model

Rough estimates per action, from Anthropic's per-token prices. Your real numbers appear under **Usage** in the Anthropic console.

| Model (Settings → Claude model) | Notes import | Meal photo | Insights analysis |
|---|---|---|---|
| **Opus 5** — most capable | ~10–15¢ | ~3–6¢ | ~20–30¢ |
| **Sonnet 5** — about 40% cheaper | ~5–10¢ | ~2–4¢ | ~12–18¢ |
| **Haiku 4.5** — cheapest | ~1¢ | <1¢ | ~2–4¢ |

Most of the gap between Opus/Sonnet and Haiku is the *thinking* step: the Claude 5 models reason before answering and that reasoning is billed like output. Haiku skips it — much cheaper, but noticeably worse at messy shorthand, supersets, and noticing patterns in insights.

Realistically: importing daily on Sonnet is **a few dollars a month**; on Haiku, well under a dollar. Logging by hand costs nothing.

---

## Inviting other people

Anyone can sign in at your URL and get their own private account — nothing else to configure. Their data is isolated from yours by the database itself.

If you'd rather keep it to yourself, go to Supabase → **Authentication → Providers → Email** and turn off **Enable signups** after you've created your own account.

---

## Troubleshooting

**"APP_ENCRYPTION_KEY must decode to exactly 32 bytes"**
The value isn't a valid 32-byte base64 string. Re-run `openssl rand -base64 32` and paste the entire output including the trailing `=`.

**"Invalid path specified in request URL" when requesting a sign-in link**
Your deployment predates the URL fix, or the Supabase URL has an extra path on it. Set `NEXT_PUBLIC_SUPABASE_URL` to the bare `https://<something>.supabase.co` and **redeploy** — `NEXT_PUBLIC_` values are baked in at build time, so editing the variable alone changes nothing until the next build.

**"An error occurred in the Server Components render" right after signing in**
The tables exist but signed-in users can't access them — usually because the schema was run before it included the `grant` statements. Re-run [`supabase/schema.sql`](supabase/schema.sql) (it's safe to run twice).

**Sign-in link opens but I'm still logged out**
The Redirect URL in step 3 doesn't match your actual domain. It must be exactly `https://your-domain/auth/callback`, including `https://`.

**"That Anthropic API key was rejected"**
Either the key was copied incompletely, or the Anthropic account has no credit. Check **Billing** in the Anthropic console.

**Everything loads but there's no data and no error**
The schema didn't run. Redo step 1.5 and confirm you copied the whole file.

**"Your database needs a one-line update first" when turning on Auto-remember foods** <a id="food-memory"></a>
Your database predates the Food memory setting. In Supabase → **SQL Editor**, run:

```sql
alter table public.profiles
  add column if not exists auto_remember_foods boolean not null default false;
```

(Re-running the whole [`supabase/schema.sql`](supabase/schema.sql) does the same; it's safe to run twice.) Everything else about saved foods and search works without it.

**I changed `APP_ENCRYPTION_KEY` and AI features broke**
Stored keys can no longer be decrypted. Everyone re-enters their API key in Settings; nothing else is lost.
