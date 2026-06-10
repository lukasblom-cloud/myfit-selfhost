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
  cardinality(m."RIRProgression") as total_weeks,
  least(
    (floor(extract(epoch from (now() - m."startDate")) / 604800)::int + 1),
    cardinality(m."RIRProgression")
  ) as week_number,
  m."RIRProgression" as rir_progression,
  (select count(*) from myfit."WorkoutOfMesocycle" wom where wom."mesocycleId" = m.id) as workouts_logged
from myfit."Mesocycle" m
where m."startDate" is not null and m."endDate" is null;
