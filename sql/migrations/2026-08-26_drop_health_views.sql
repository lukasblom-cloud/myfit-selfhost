-- Drop the health.* cross-schema views. See the decision note in
-- sql/health_views.sql for the reasoning.
--
-- Reversible: the full DDL is still committed at sql/health_views.sql, so
-- recreating them is one command if a health-ops consumer ever appears.
--
-- Session pooler (5432) only:
--   ~/Systems/01-HUB/ai-cos-rag/dbq.sh "$(cat sql/migrations/2026-08-26_drop_health_views.sql)"

drop view if exists health.current_mesocycle;
drop view if exists health.lifting_weekly_volume;
drop view if exists health.lifting_sessions;

-- Leave the schema itself: empty, harmless, and it keeps any grants intact.
