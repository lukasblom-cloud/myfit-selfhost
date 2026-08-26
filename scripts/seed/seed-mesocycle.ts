// Build a Mesocycle FROM an existing ExerciseSplit.
//
//   npx tsx scripts/seed/seed-mesocycle.ts --split "<split name>"                 # dry run
//   npx tsx scripts/seed/seed-mesocycle.ts --split "<name>" --write [--start]
//
// A split carries no set counts and no RIR — that all lives here. Start volume
// is seeded from RP's per-muscle MEV and the ceiling from RP's per-muscle MRV
// rather than the app UI's flat 30 (see the gap table, row 7, in the vault at
// "09-HEALTH & FITNESS/Dead Lifts progression scheme.md").
//
// Volume distribution mirrors distributeStartVolumes() in
// src/routes/mesocycles/manage/mesocycleRunes.svelte.ts exactly.

import { createId } from '@paralleldrive/cuid2';
import type { MuscleGroup, Prisma } from '@prisma/client';
import { RP_MEV, RP_MRV, withPrisma, resolveUserId } from './lib.js';

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const splitName = arg('--split');
const write = args.includes('--write');
const startImmediately = args.includes('--start');
const userEmail = arg('--user') ?? 'owner@example.com';
const mesoName = arg('--name');
const minSets = Number(arg('--min-sets') ?? 2);
// index = RIR, value = weeks at that RIR. Runs highest-RIR first, so
// [1,3,3,3] = 3wk@3RIR, 3wk@2, 3wk@1, 1wk@0 = 10 weeks. App default.
const rirProgression = (arg('--rir') ?? '1,3,3,3').split(',').map(Number);
const overload = Number(arg('--overload') ?? 2.5);
const setIncreaseAmount = Number(arg('--set-increase') ?? 1);

if (!splitName) {
	console.error('Usage: tsx scripts/seed/seed-mesocycle.ts --split "<name>" [--write] [--start]');
	console.error('  [--name <meso name>] [--user <email>] [--rir 1,3,3,3] [--overload 2.5]');
	console.error('  [--set-increase 1] [--min-sets 2]');
	process.exit(1);
}

function distributeEvenly(volume: number, n: number): number[] {
	if (n <= 0) return [];
	const base = Math.floor(volume / n);
	const remainder = volume % n;
	return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

function distributeEvenlyWithMinimum(v: number, n: number, m: number): number[] {
	const f = Math.floor(v / m);
	if (f > n) return distributeEvenly(v, n);
	const a: number[] = Array(f).fill(m);
	const r = distributeEvenly(v - m * f, f);
	for (let i = 0; i < f; i++) a[i] += r[i];
	for (let i = 0; i < n - f; i++) a.push(0);
	return a;
}

await withPrisma(async (prisma) => {
	const userId = await resolveUserId(prisma, userEmail);

	const split = await prisma.exerciseSplit.findFirst({
		where: { userId, name: splitName },
		include: {
			exerciseSplitDays: {
				include: { exercises: { orderBy: { exerciseIndex: 'asc' } } },
				orderBy: { dayIndex: 'asc' }
			}
		}
	});
	if (!split) throw new Error(`No split named "${splitName}" for ${userEmail}.`);

	// Per-day exercise templates, sets filled in below.
	const templates = split.exerciseSplitDays.map((day) =>
		day.exercises.map((ex) => ({
			name: ex.name,
			exerciseIndex: ex.exerciseIndex,
			targetMuscleGroup: ex.targetMuscleGroup,
			customMuscleGroup: ex.customMuscleGroup,
			bodyweightFraction: ex.bodyweightFraction,
			sets: 0,
			setType: ex.setType,
			repRangeStart: ex.repRangeStart,
			repRangeEnd: ex.repRangeEnd,
			changeType: ex.changeType,
			changeAmount: ex.changeAmount,
			note: ex.note,
			overloadPercentage: null,
			lastSetToFailure: null,
			forceRIRMatching: null,
			minimumWeightChange: null,
			topRepRangeStart: ex.topRepRangeStart,
			topRepRangeEnd: ex.topRepRangeEnd
		}))
	);

	// One cyclic set change per muscle group present in the split.
	const muscleKeys = new Map<string, { muscleGroup: MuscleGroup; customMuscleGroup: string | null }>();
	for (const day of templates) {
		for (const ex of day) {
			const key = ex.customMuscleGroup ?? ex.targetMuscleGroup;
			if (!muscleKeys.has(key)) {
				muscleKeys.set(key, { muscleGroup: ex.targetMuscleGroup, customMuscleGroup: ex.customMuscleGroup });
			}
		}
	}

	const setChanges = [...muscleKeys.entries()].map(([key, m]) => ({
		...m,
		regardlessOfProgress: false,
		setIncreaseAmount,
		maxVolume: RP_MRV[m.muscleGroup],
		startVolume: RP_MEV[m.muscleGroup],
		key
	}));

	// Distribute start volume — mirrors distributeStartVolumes().
	for (const sc of setChanges) {
		const dayIdxs = templates
			.map((day, i) => (day.some((ex) => (ex.customMuscleGroup ?? ex.targetMuscleGroup) === sc.key) ? i : -1))
			.filter((i) => i !== -1);
		if (!dayIdxs.length) continue;

		const perDay = distributeEvenly(sc.startVolume, dayIdxs.length);
		dayIdxs.forEach((dayIndex, i) => {
			const targeting = templates[dayIndex].filter((ex) => (ex.customMuscleGroup ?? ex.targetMuscleGroup) === sc.key);
			const perExercise = distributeEvenlyWithMinimum(perDay[i], targeting.length, minSets);
			targeting.forEach((ex, idx) => (ex.sets = perExercise[idx] ?? 0));
		});
	}

	const totalWeeks = rirProgression.reduce((a, b) => a + b, 0);
	const name = mesoName ?? `${split.name} — block 1`;

	console.log('');
	console.log(`MESOCYCLE: ${name}`);
	console.log(`  from split      ${split.name}`);
	console.log(`  owner           ${userEmail}`);
	console.log(`  RIRProgression  [${rirProgression}]  = ${totalWeeks} weeks`);
	console.log(`  week-by-week    ${weekByWeek(rirProgression).join(' ')}`);
	console.log(`  overload        ${overload}% / set / week`);
	console.log(`  lastSetToFailure=true  forceRIRMatching=true  (app defaults)`);
	console.log('');
	console.log('  START VOLUME (sets/cycle) vs CEILING — RP MEV -> MRV, per muscle:');
	console.log(`     ${'MUSCLE'.padEnd(14)}${'START'.padEnd(8)}${'MAX'.padEnd(8)}+/wk`);
	for (const sc of setChanges.sort((a, b) => b.startVolume - a.startVolume)) {
		const actual = templates
			.flat()
			.filter((e) => (e.customMuscleGroup ?? e.targetMuscleGroup) === sc.key)
			.reduce((a, e) => a + e.sets, 0);
		const note = actual !== sc.startVolume ? `  (actual ${actual} after min-sets rounding)` : '';
		console.log(
			`     ${sc.key.padEnd(14)}${String(sc.startVolume).padEnd(8)}${String(sc.maxVolume).padEnd(8)}${setIncreaseAmount}${note}`
		);
	}
	console.log('');
	console.log('  SETS PER EXERCISE:');
	split.exerciseSplitDays.forEach((day, i) => {
		if (day.isRestDay) return console.log(`     [${day.dayIndex}] ${day.name} — REST`);
		console.log(`     [${day.dayIndex}] ${day.name}`);
		templates[i].forEach((ex) =>
			console.log(
				`         ${String(ex.sets).padStart(2)} x ${ex.name.padEnd(32)} ${ex.repRangeStart}-${ex.repRangeEnd} ${ex.setType}`
			)
		);
	});
	console.log('');

	// RP's MEV is sets per WEEK. distributeStartVolumes spreads it only across the
	// days a muscle is actually trained, so a muscle that appears on one day of the
	// split absorbs its whole weekly MEV in a single session. That's arithmetically
	// what the app does, but it's poor practice — RP wants frequency, not stacking.
	const SANE_SETS_PER_SESSION = 8;
	const stacked: string[] = [];
	templates.forEach((day, i) => {
		const perMuscle = new Map<string, number>();
		for (const ex of day) {
			const key = ex.customMuscleGroup ?? ex.targetMuscleGroup;
			perMuscle.set(key, (perMuscle.get(key) ?? 0) + ex.sets);
		}
		for (const [m, n] of perMuscle) {
			if (n > SANE_SETS_PER_SESSION) {
				stacked.push(`       ${m} — ${n} sets in one session (${split.exerciseSplitDays[i].name})`);
			}
		}
	});
	if (stacked.length) {
		console.log(`  ⚠ MEV STACKED INTO ONE SESSION — these muscles are trained too infrequently`);
		console.log(`    in this split to reach RP's weekly MEV without piling sets up:`);
		stacked.forEach((l) => console.log(l));
		console.log('    Fix the split (add a second slot for that muscle on another day),');
		console.log("    or accept it and lower that muscle's start volume by hand.");
		console.log('');
	}

	const zeroSet = templates.flat().filter((e) => e.sets === 0);
	if (zeroSet.length) {
		console.log(`  ⚠ ${zeroSet.length} exercise(s) got 0 sets (MEV too low to give every slot ${minSets}):`);
		zeroSet.forEach((e) => console.log(`       ${e.name}`));
		console.log('    Lower --min-sets, or drop those exercises from the split.');
		console.log('');
	}

	if (!write) {
		console.log('DRY RUN — nothing written. Re-run with --write to commit.');
		return;
	}

	if (startImmediately) {
		const active = await prisma.mesocycle.findFirst({
			where: { userId, startDate: { not: null }, endDate: null },
			select: { id: true, name: true }
		});
		if (active)
			throw new Error(`"${active.name}" is already active for ${userEmail}. Finish it before starting another.`);
	}

	const mesocycleId = createId();
	const mesocycle: Prisma.MesocycleUncheckedCreateInput = {
		id: mesocycleId,
		userId,
		name,
		exerciseSplitId: split.id,
		RIRProgression: rirProgression,
		startDate: startImmediately ? new Date() : null,
		endDate: null,
		startOverloadPercentage: overload,
		lastSetToFailure: true,
		forceRIRMatching: true
	};

	const days: Prisma.MesocycleExerciseSplitDayUncheckedCreateInput[] = split.exerciseSplitDays.map((d) => ({
		id: createId(),
		name: d.name,
		dayIndex: d.dayIndex,
		isRestDay: d.isRestDay,
		mesocycleId
	}));

	const exerciseTemplates: Prisma.MesocycleExerciseTemplateUncheckedCreateInput[] = templates.flatMap((day, i) =>
		day.map((ex) => ({ ...ex, id: createId(), mesocycleExerciseSplitDayId: days[i].id as string }))
	);

	const cyclicSetChanges: Prisma.MesocycleCyclicSetChangeUncheckedCreateInput[] = setChanges.map(
		({ startVolume, key, ...sc }) => ({ ...sc, id: createId(), mesocycleId })
	);

	await prisma.$transaction([
		prisma.mesocycle.create({ data: mesocycle }),
		prisma.mesocycleCyclicSetChange.createMany({ data: cyclicSetChanges }),
		prisma.mesocycleExerciseSplitDay.createMany({ data: days }),
		prisma.mesocycleExerciseTemplate.createMany({ data: exerciseTemplates })
	]);

	console.log(`WROTE mesocycle "${name}" (${mesocycleId})`);
	console.log(
		`  ${days.length} days, ${exerciseTemplates.length} exercise templates, ${cyclicSetChanges.length} set-change rules`
	);
	console.log(
		startImmediately
			? '  STARTED — startDate set to now.'
			: '  Not started. Start it in the app, or re-run with --start.'
	);
});

function weekByWeek(rir: number[]): string[] {
	const out: string[] = [];
	for (let i = rir.length - 1; i >= 0; i--) for (let w = 0; w < rir[i]; w++) out.push(`${i}`);
	return out;
}
