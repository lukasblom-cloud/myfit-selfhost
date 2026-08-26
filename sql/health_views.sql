-- RETIRED 26 Aug 2026 — these views are NOT deployed. Kept as the recipe.
--
-- Why they went: they existed so a separate health-ops service could read
-- Dead Lifts data without touching myfit tables. That service was never built
-- and isn't planned. After ~2.5 months they had zero consumers anywhere in the
-- estate — grepping for all three names found only this file.
--
-- Three specific reasons not to keep them on standby:
--   1. current_mesocycle is now redundant. /api/meso-state answers exactly the
--      same question, and does it correctly — the view carried the same
--      cardinality("RIRProgression") bug for its whole life precisely BECAUSE
--      nothing read it. An unread view is an unverified one.
--   2. The obvious consumer can't reach them. The Cotsworth calendar talks to a
--      different Supabase project (nuuschplwcljkfboaxfo), not cos-rag, so it was
--      never going to query these regardless.
--   3. Prisma migrations don't know cross-schema views exist, so they rot
--      silently when the app's schema moves under them.
--
-- What replaced them: /api/meso-state now serves weekly volume (total sets,
-- tonnage, and a per-muscle breakdown) alongside the mesocycle state, over the
-- token-gated endpoint the calendar already consumes. Same data, a consumer
-- that actually exists.
--
-- To bring them back: run this file through the SESSION pooler (5432).
--   ~/Systems/01-HUB/ai-cos-rag/dbq.sh "$(cat sql/health_views.sql)"

-- Cross-schema read views for health-ops over Dead Lifts (myfit schema) data.
-- Owned by postgres; health-ops provisions into this same Supabase project and
-- reads these instead of touching myfit tables directly.
create schema if not exists health;

create or replace view health.lifting_weekly_volume as
select
  date_trunc('week', w."startedAt")::date as week_start,
  coalesce(we."customMuscleGroup", we."targetMuscleGroup"::text) as muscle_group,
  count(s.id) filter (where not s.skipped) as sets,
  round(sum(s.reps * s.load) filter (where not s.skipped)::numeric, 1) as tonnage
from myfit."Workout" w
join myfit."WorkoutExercise" we on we."workoutId" = w.id
join myfit."WorkoutExerciseSet" s on s."workoutExerciseId" = we.id
group by 1, 2;

create or replace view health.lifting_sessions as
select
  w.id,
  w."startedAt",
  w."endedAt",
  round((extract(epoch from (w."endedAt" - w."startedAt")) / 60)::numeric, 0) as duration_min,
  w."userBodyweight" as bodyweight,
  (select count(*) from myfit."WorkoutExercise" we where we."workoutId" = w.id) as exercises,
  wom."mesocycleId"
from myfit."Workout" w
left join myfit."WorkoutOfMesocycle" wom on wom."workoutId" = w.id;

create or replace view health.current_mesocycle as
select
  m.id,
  m.name,
  m."startDate" as start_date,
  -- RIRProgression is indexed BY RIR value; each element is the number of weeks
  -- spent at that RIR. Block length is therefore the SUM, not the cardinality.
  (select sum(x) from unnest(m."RIRProgression") as x)::int as total_weeks,
  least(
    (floor(extract(epoch from (now() - m."startDate")) / 604800)::int + 1),
    (select sum(x) from unnest(m."RIRProgression") as x)::int
  ) as week_number,
  m."RIRProgression" as rir_progression,
  (select count(*) from myfit."WorkoutOfMesocycle" wom where wom."mesocycleId" = m.id) as workouts_logged
from myfit."Mesocycle" m
where m."startDate" is not null and m."endDate" is null;
