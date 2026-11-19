-- =============================================================================
-- Lift & Macro Tracker — database schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: everything is IF NOT EXISTS / CREATE OR REPLACE.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- profiles: one row per signed-in user
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  display_name              text,
  weight_unit               text not null default 'lb' check (weight_unit in ('lb','kg')),
  -- The user's own Anthropic API key, encrypted with AES-256-GCM app-side.
  -- The server can decrypt it; nobody reading the database can.
  anthropic_key_ciphertext  text,
  anthropic_key_hint        text,            -- last 4 chars, for "sk-...abcd" display
  model                     text not null default 'claude-opus-5',
  -- Pre-tick "Remember this food" for foods logged with your own numbers.
  auto_remember_foods       boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- LIFTING
-- -----------------------------------------------------------------------------

-- An exercise is a *specific* movement. "Cable row" at your gym on the wide bar
-- is a different row from "cable row" narrow grip, and from the one at the other
-- gym whose stack starts at 20 lb. match_key is the normalized dedupe key the
-- importer uses so the LLM doesn't create near-duplicates.
create table if not exists public.exercises (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  name                      text not null,
  equipment                 text,            -- barbell | dumbbell | machine | cable | bodyweight | smith | other
  grip                      text,            -- wide | narrow | neutral | pronated | supinated | ...
  angle                     text,            -- incline | decline | flat | 30deg | ...
  variant                   text,            -- any other distinguishing detail
  gym                       text,            -- which gym / machine brand this belongs to
  primary_muscles           text[] not null default '{}',
  secondary_muscles         text[] not null default '{}',
  -- Some machines are not zero at the bottom of the stack (or the carriage
  -- itself weighs something). Effective load = logged weight + this.
  starting_resistance_lbs   numeric not null default 0,
  unilateral                boolean not null default false,
  notes                     text,
  match_key                 text not null,
  archived                  boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (user_id, match_key)
);
create index if not exists exercises_user_idx on public.exercises(user_id) where not archived;

create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  title         text,
  gym           text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists workouts_user_date_idx on public.workouts(user_id, date desc);

-- One block per exercise performed, ordered by `position` = order performed.
create table if not exists public.workout_exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workout_id    uuid not null references public.workouts(id) on delete cascade,
  exercise_id   uuid not null references public.exercises(id) on delete restrict,
  position      int not null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists workout_exercises_workout_idx
  on public.workout_exercises(workout_id, position);

create table if not exists public.workout_sets (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  workout_exercise_id   uuid not null references public.workout_exercises(id) on delete cascade,
  set_index             int not null,          -- 1-based, within this exercise
  is_warmup             boolean not null default false,
  rpe                   numeric,
  notes                 text,                  -- injury, pain, form cues, "felt easy"
  created_at            timestamptz not null default now()
);
create index if not exists workout_sets_we_idx
  on public.workout_sets(workout_exercise_id, set_index);

-- A normal set has exactly ONE segment. A superset / drop set
-- ("3 reps @ 50 lb + 2 reps @ 30 lb") has one segment per weight.
create table if not exists public.set_segments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  set_id        uuid not null references public.workout_sets(id) on delete cascade,
  segment_index int not null,                  -- 1-based, order performed
  weight_lbs    numeric,                       -- as logged (plates / pin). NULL = bodyweight
  reps          numeric,                       -- half reps are real data: 7.5
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists set_segments_set_idx
  on public.set_segments(set_id, segment_index);

-- -----------------------------------------------------------------------------
-- DIET
-- -----------------------------------------------------------------------------

-- A saved food. `is_default` marks the brand to assume when the user just says
-- "greek yogurt" — editable, and overridable per entry.
create table if not exists public.food_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,                 -- "greek yogurt"
  brand         text,                          -- "Fage 0%"
  is_default    boolean not null default false,
  serving_qty   numeric not null default 1,
  serving_unit  text not null default 'serving',
  kcal          numeric,
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  fiber_g       numeric,
  micros        jsonb not null default '{}'::jsonb,
  notes         text,
  match_key     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, match_key)
);
-- At most one default brand per food name, per user.
create unique index if not exists food_items_one_default_per_name
  on public.food_items(user_id, lower(name)) where is_default;

create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  servings      numeric not null default 1,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.recipe_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  food_item_id  uuid references public.food_items(id) on delete set null,
  position      int not null default 0,
  name          text not null,
  qty           numeric,
  unit          text,
  kcal          numeric,
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  fiber_g       numeric,
  micros        jsonb not null default '{}'::jsonb
);
create index if not exists recipe_items_recipe_idx on public.recipe_items(recipe_id, position);

-- One row per calendar day the user has diet data for. `completeness` is how
-- charts and averages know whether a low day was a real low day or a day the
-- user just didn't finish logging.
create table if not exists public.diet_days (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  date               date not null,
  completeness       text not null default 'complete'
                     check (completeness in ('complete','partial','untracked')),
  completeness_note  text,
  ai_micro_summary   text,
  ai_micro_data      jsonb,
  ai_summary_at      timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.diet_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  meal          text not null default 'unspecified'
                check (meal in ('breakfast','lunch','dinner','snack','unspecified')),
  position      int not null default 0,
  name          text not null,
  qty           numeric,
  unit          text,
  kcal          numeric,
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  fiber_g       numeric,
  micros        jsonb not null default '{}'::jsonb,
  source        text not null default 'manual'
                check (source in ('manual','photo','text_import','recipe','food_item')),
  confidence    text check (confidence in ('high','medium','low')),
  food_item_id  uuid references public.food_items(id) on delete set null,
  recipe_id     uuid references public.recipes(id) on delete set null,
  photo_path    text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists diet_entries_user_date_idx on public.diet_entries(user_id, date desc);

-- Targets are dated so history stays honest when the user changes their goal.
-- protein_mode='bodyweight' recomputes protein_g as multiplier * bodyweight(lb).
create table if not exists public.targets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  effective_from      date not null default current_date,
  kcal                numeric,
  protein_g           numeric,
  carbs_g             numeric,
  fat_g               numeric,
  fiber_g             numeric,
  protein_mode        text not null default 'bodyweight'
                      check (protein_mode in ('bodyweight','manual')),
  protein_multiplier  numeric not null default 0.8,
  created_at          timestamptz not null default now(),
  unique (user_id, effective_from)
);

-- -----------------------------------------------------------------------------
-- BODYWEIGHT
-- -----------------------------------------------------------------------------
-- Always stored in lb; the UI converts for display based on profiles.weight_unit.
create table if not exists public.bodyweight_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  logged_at   timestamptz,                      -- optional time of day
  weight_lbs  numeric not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists bodyweight_user_date_idx on public.bodyweight_logs(user_id, date desc);

-- -----------------------------------------------------------------------------
-- AI: import audit log + generated insights
-- -----------------------------------------------------------------------------
-- Every import keeps its raw input forever, so nothing the user pasted is lost
-- and a bad parse can be re-run without retyping.
create table if not exists public.imports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('lifts','diet','mixed','photo')),
  raw_text     text,
  image_path   text,
  model        text,
  status       text not null default 'parsed' check (status in ('parsing','parsed','applied','failed')),
  parsed       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists imports_user_idx on public.imports(user_id, created_at desc);

-- A long paste (months of notes) is too big for one AI request, so it's split
-- between sessions and each piece is parsed in its own request. One row per piece
-- lets those requests run independently and resume if the page is closed midway.
create table if not exists public.import_chunks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  import_id   uuid not null references public.imports(id) on delete cascade,
  idx         int not null,
  text        text not null,
  status      text not null default 'pending'
              check (status in ('pending','parsing','done','failed')),
  result      jsonb,
  error       text,
  updated_at  timestamptz not null default now(),
  unique (import_id, idx)
);

create table if not exists public.insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null default 'weekly',
  period_start  date,
  period_end    date,
  body_md       text not null,
  data          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists insights_user_idx on public.insights(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- TABLE PRIVILEGES
-- Newer Supabase projects no longer grant the API roles access to tables created
-- in the SQL editor, so without this every signed-in request fails with
-- "permission denied for table …". Only `authenticated` is granted: the app never
-- reads data while signed out, so anonymous visitors get no table access at all.
-- These grants say "signed-in users may use these tables"; the RLS policies below
-- then narrow that to "…but only their own rows".
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Every table is user-scoped. Without these policies one user could read
-- another's data; with them, the database itself enforces isolation even if the
-- application code has a bug.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','exercises','workouts','workout_exercises','workout_sets','set_segments',
    'food_items','recipes','recipe_items','diet_days','diet_entries','targets',
    'bodyweight_logs','imports','import_chunks','insights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
  end loop;
end $$;

create policy profiles_owner on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'exercises','workouts','workout_exercises','workout_sets','set_segments',
    'food_items','recipes','recipe_items','diet_days','diet_entries','targets',
    'bodyweight_logs','imports','import_chunks','insights'
  ] loop
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- STORAGE: private bucket for meal photos, one folder per user
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

drop policy if exists "meal photos are private to their owner" on storage.objects;
create policy "meal photos are private to their owner" on storage.objects
  for all
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','exercises','workouts','food_items','recipes','diet_days','diet_entries'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- UPGRADES for databases created from an earlier version of this file.
-- `create table if not exists` won't change an existing table, so column and
-- constraint changes are applied here. All of it is safe to re-run.
-- -----------------------------------------------------------------------------
alter table public.set_segments alter column reps type numeric using reps::numeric;

alter table public.imports drop constraint if exists imports_status_check;
alter table public.imports add constraint imports_status_check
  check (status in ('parsing','parsed','applied','failed'));

grant select, insert, update, delete on public.import_chunks to authenticated;

-- Food memory: the "Auto-remember foods" setting.
alter table public.profiles
  add column if not exists auto_remember_foods boolean not null default false;
