# scripts/

Local operator scripts. All run with `npx tsx` from the repo root, and all read
`.env` for `DATABASE_URL`. None of them are part of the deployed bundle.

Use **npm, not pnpm** — pnpm segfaults on node 24 here.

## seed/ — splits and mesocycles

Seeds training data straight into the DB, bypassing the app UI. Written so that
turning a screenshot of an RP split into live data is a five-minute job.

```
npx tsx scripts/seed/seed-split.ts <file.json>            # dry run — prints a table, writes nothing
npx tsx scripts/seed/seed-split.ts <file.json> --write
npx tsx scripts/seed/seed-mesocycle.ts --split "<name>"   # dry run
npx tsx scripts/seed/seed-mesocycle.ts --split "<name>" --write --start
```

`example-split.json` is a worked example of the input format.

Things worth knowing before you use these:

- **A split has no set counts.** `ExerciseSplit` is a skeleton of days and
  exercises. Sets-per-week and the RIR ramp live in a `Mesocycle` built *from*
  the split. That's why seeding is two steps, not one.
- **Dry run is the default.** Both scripts print a full mapped table and exit
  unless you pass `--write`. Everything auto-filled or guessed is flagged.
- Unknown muscle names fall through to the `Custom` enum carrying their original
  label rather than being guessed at — and are flagged.
- Rep ranges auto-fill 8–12 for compounds and 12–20 for isolation, off a name
  heuristic that is occasionally wrong. Check the flags.
- `seed-mesocycle` seeds per-muscle `maxVolume` from RP's published MRV rather
  than the app UI's flat 30 for every muscle group. See the vault note
  "09-HEALTH & FITNESS/Dead Lifts progression scheme.md", gap table row 7.
- Writes go over the **transaction pooler (6543)**, which is what `.env` already
  points at. Correct for DML.

## dev/ — crew sharing smoke test

```
npx tsx scripts/dev/crew-smoke.ts setup              # fixtures + session cookies
npx tsx scripts/dev/crew-smoke.ts token <email>      # mint one session cookie
npx tsx scripts/dev/crew-smoke.ts backfill <email>   # prove a pending grant activates
npx tsx scripts/dev/crew-smoke.ts teardown           # remove every fixture
```

Creates throwaway users on `@example.invalid` (RFC 2606 — can never be a real
address) and mints session rows, so the real tRPC router can be driven over HTTP
without typing the `/login` break-glass password. `teardown` matches on that
domain, so it cannot delete a real account.

## Migrations

DDL lives in `sql/migrations/`. Apply it through the **session pooler (5432)** —
the transaction pooler on 6543 hangs on DDL:

```
~/Systems/01-HUB/ai-cos-rag/dbq.sh "$(cat sql/migrations/<file>.sql)"
```

`dbq.sh` is already pointed at 5432.
