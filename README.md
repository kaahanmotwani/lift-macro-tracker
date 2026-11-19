# Lift & Macro Tracker

A private training log that answers one question honestly: **are you actually getting stronger, and is your eating supporting it?**

Most tracking apps make you re-type your workout into their forms. This one reads the notes you already keep — shorthand, typos, mixed lifts and meals in one blob — and turns them into structured data you can chart. Point a camera at dinner and it estimates the macros. Then it tells you, in plain language, whether the numbers are going up.

It runs as a web app that installs to your iPhone home screen like a native app.

<!-- Add a screenshot here once you've deployed: ![Screenshot](docs/screenshot.png) -->

---

## What it does

### Import from anything

- **Paste natural language.** Copy a week of notes straight out of the iOS Notes app. Claude maps it to the app's structure — exercises, sets, weights, reps, meals, weigh-ins — and shows you exactly what it extracted before anything is saved.
- **Photo → macros.** Snap a meal; get a per-component macro estimate with an honest confidence rating and a stated portion assumption (the thing most likely to be wrong).
- **Nothing is invented.** If your notes didn't state a weight, the field stays blank instead of being guessed. Anything the model couldn't map is shown verbatim rather than silently dropped.
- **Nothing is lost.** The original text is kept forever, so a bad parse can be re-run without retyping.

### Lifting

- Every session is its own day, with exercises **in the order you performed them**.
- Sets are enumerated and grouped by exercise. Each set records weight, reps, RPE, warmup flag, and free-text notes for injuries or how it felt.
- **Supersets and drop sets** are first-class: one set can hold multiple weights (`3 reps @ 50 lb + 2 reps @ 30 lb`) in the order performed, not flattened into two fake sets.
- **Similar lifts stay distinct.** Wide-grip vs. neutral-grip, incline vs. flat, this gym's cable machine vs. that one — each carries its own progression, because they aren't comparable.
- **Starting resistance** is supported per exercise. If a stack starts at 20 lb, charts add it, so a machine lift is comparable to a free-weight one.
- Each exercise gets a progression view: estimated 1RM over time, volume per session, and the full session log.
- While logging, you see **what you did last time** for that exercise.

### Diet & macros

- Per day: protein, carbs, fat, fiber, and calories (computed from macros if you leave calories blank).
- **Micronutrients are never typed in.** They're estimated from what you ate and summarized by Claude on demand.
- **Targets** per macro. Protein defaults to **0.8 × bodyweight (lb)** and recalculates from your latest weigh-in, so it follows you instead of going stale.
- **Saved foods with default brands.** Tell it your usual Greek yogurt once; from then on "greek yogurt" uses those macros — still editable per entry when you bought something else.
- **Recipes.** Save a mix (overnight oats and its ingredients), then log it in one tap and scale by servings.
- **Incomplete days are marked, not faked.** Mark a day *partial* or *untracked* and it's excluded from averages and drawn as a gap in charts. A day you forgot to log dinner is not a 900-calorie day, and the analytics won't pretend it was.
- Charts: calories over time, and the same window broken out by protein / carbs / fat / fiber.

### Bodyweight

- Log a weight, optionally with a time. Defaults to today; editable during and after entry.
- Enter in lb or kg per weigh-in; everything is stored in pounds so switching units never rewrites history.

### Insights

- Claude reads your real numbers and reports: strength trends per exercise and body part, which body parts you're neglecting, how intake tracks against targets, and observable relationships between the two.
- Partially-logged days are handed over *labelled*, and the prompt forbids averaging them in.
- It's told to say plainly when there isn't enough data yet, and to give no medical or nutritional advice.

### Everywhere else

- **Everything is editable during and after entry** — every set, segment, meal, weigh-in, and target.
- **Installs to your home screen** (iOS Safari → Share → Add to Home Screen). Full screen, own icon, no browser chrome.
- **Works without JavaScript.** Every mutation is a plain HTML form, so logging a set works on bad gym wifi before the page has fully loaded.
- **Export everything** as JSON, any time.

---

## Using it

**The hosted version:** sign in with Google or an emailed link. Your data is yours — isolated at the database level, not just in the app.

**AI features use your own Anthropic API key.** You add it in Settings; it's stored encrypted and used only for your requests. This means nobody else pays for or can see your imports, and there's no usage cap imposed by whoever runs the instance. It costs a few cents per import — see [DEPLOY.md](DEPLOY.md#what-it-costs).

**Want your own copy?** You can run your own instance, with your own database that nobody else can reach, in about 20 minutes and without writing any code. **[DEPLOY.md](DEPLOY.md)** walks through it click by click.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_USERNAME%2Flift-macro-tracker&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,APP_ENCRYPTION_KEY&envDescription=Supabase%20project%20credentials%20plus%20a%2032-byte%20base64%20encryption%20key&envLink=https%3A%2F%2Fgithub.com%2FYOUR_USERNAME%2Flift-macro-tracker%2Fblob%2Fmain%2FDEPLOY.md)

> Replace `YOUR_USERNAME` in that button's URL with your GitHub username after you publish, or it will deploy someone else's fork. You still need the Supabase steps in DEPLOY.md — the button only handles the hosting half.

---

## Running it yourself

```bash
git clone https://github.com/YOUR_USERNAME/lift-macro-tracker.git
cd lift-macro-tracker
npm install
cp .env.example .env.local   # fill in the values — see DEPLOY.md
npm run icons                # generates the app icons
npm run dev
```

Then run [`supabase/schema.sql`](supabase/schema.sql) once in your Supabase project's SQL editor.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Safe to expose — Row Level Security is what protects the data. |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts stored API keys. |
| `ANTHROPIC_API_KEY` | **Optional.** Only set this if you intend to pay for every user's AI usage. |

---

## How it's built

Next.js (App Router) on Vercel, Postgres + auth + file storage on Supabase, Claude for the language work. No charting library — the charts are hand-drawn SVG so that "you didn't log this day" can be a real visual state instead of a zero.

**[ARCHITECTURE.md](ARCHITECTURE.md)** explains the design decisions and why each one was made — written for someone who understands software but doesn't write it daily.

---

## License

MIT — see [LICENSE](LICENSE). Fork it, change it, run your own.
