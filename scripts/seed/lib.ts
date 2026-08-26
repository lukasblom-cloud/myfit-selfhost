// Shared helpers for the Dead Lifts seeding scripts.
//
// These run OUTSIDE SvelteKit, so `$env/dynamic/private` and the `$lib/prisma`
// singleton aren't available. A standalone script owns exactly one
// PrismaClient and must disconnect it — see `withPrisma` below. Never import
// this from anything that runs inside the app.

import { PrismaClient, type MuscleGroup, type SetType } from '@prisma/client';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../.env') });

export const MUSCLE_GROUPS = [
	'Chest',
	'FrontDelts',
	'SideDelts',
	'RearDelts',
	'Lats',
	'Traps',
	'Triceps',
	'Biceps',
	'Forearms',
	'Quads',
	'Hamstrings',
	'Glutes',
	'Calves',
	'Abs',
	'Neck',
	'Adductors',
	'Abductors',
	'Custom'
] as const satisfies readonly MuscleGroup[];

export const SET_TYPES = [
	'Straight',
	'V2',
	'Drop',
	'Down',
	'Myorep',
	'MyorepMatch',
	'MyorepMatchDown',
	'TopBackoff'
] as const satisfies readonly SetType[];

// How RP's screenshots and ordinary gym English spell muscle groups, mapped to
// the Prisma enum. Keys are lowercased and stripped of non-letters before lookup.
const MUSCLE_ALIASES: Record<string, MuscleGroup> = {
	chest: 'Chest',
	pecs: 'Chest',
	pectorals: 'Chest',
	upperchest: 'Chest',
	lowerchest: 'Chest',
	frontdelts: 'FrontDelts',
	frontdelt: 'FrontDelts',
	anteriordelts: 'FrontDelts',
	frontdeltoids: 'FrontDelts',
	sidedelts: 'SideDelts',
	sidedelt: 'SideDelts',
	lateraldelts: 'SideDelts',
	medialdelts: 'SideDelts',
	reardelts: 'RearDelts',
	reardelt: 'RearDelts',
	posteriordelts: 'RearDelts',
	rearvdelts: 'RearDelts',
	delts: 'SideDelts',
	shoulders: 'SideDelts',
	deltoids: 'SideDelts',
	lats: 'Lats',
	back: 'Lats',
	latissimus: 'Lats',
	upperback: 'Traps',
	midback: 'Traps',
	traps: 'Traps',
	trapezius: 'Traps',
	rhomboids: 'Traps',
	triceps: 'Triceps',
	tricep: 'Triceps',
	tris: 'Triceps',
	biceps: 'Biceps',
	bicep: 'Biceps',
	bis: 'Biceps',
	forearms: 'Forearms',
	forearm: 'Forearms',
	grip: 'Forearms',
	quads: 'Quads',
	quadriceps: 'Quads',
	quad: 'Quads',
	hamstrings: 'Hamstrings',
	hamstring: 'Hamstrings',
	hams: 'Hamstrings',
	glutes: 'Glutes',
	glute: 'Glutes',
	gluteus: 'Glutes',
	calves: 'Calves',
	calf: 'Calves',
	soleus: 'Calves',
	gastrocnemius: 'Calves',
	abs: 'Abs',
	abdominals: 'Abs',
	core: 'Abs',
	obliques: 'Abs',
	neck: 'Neck',
	adductors: 'Adductors',
	adductor: 'Adductors',
	abductors: 'Abductors',
	abductor: 'Abductors'
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function resolveMuscleGroup(raw: string): { group: MuscleGroup; custom: string | null; matched: boolean } {
	const key = normalise(raw);
	const exact = MUSCLE_GROUPS.find((g) => normalise(g) === key);
	if (exact) return { group: exact, custom: null, matched: true };
	const alias = MUSCLE_ALIASES[key];
	if (alias) return { group: alias, custom: null, matched: true };
	// Unknown muscle: keep it rather than guess, as a Custom group carrying the
	// original label. Surfaces in the dry-run as a flag so it can be corrected.
	return { group: 'Custom', custom: raw.trim(), matched: false };
}

// Rep-range auto-fill. Compound movements get ~8-12, isolation ~12-20 (the
// brief's defaults). The classifier is a name heuristic and WILL occasionally
// be wrong, so every auto-filled value is flagged in the dry-run table.
const COMPOUND_PATTERNS = [
	/squat/i,
	/deadlift/i,
	/\bpress\b/i,
	/bench/i,
	/\brow\b/i,
	/pull ?-?up/i,
	/chin ?-?up/i,
	/pulldown/i,
	/\bdip\b/i,
	/lunge/i,
	/leg press/i,
	/hack/i,
	/rdl/i,
	/romanian/i,
	/good ?morning/i,
	/clean/i,
	/snatch/i,
	/thruster/i,
	/pendlay/i,
	/\bpush ?-?up\b/i
];

export function isCompound(exerciseName: string): boolean {
	return COMPOUND_PATTERNS.some((p) => p.test(exerciseName));
}

export function defaultRepRange(exerciseName: string): [number, number] {
	return isCompound(exerciseName) ? [8, 12] : [12, 20];
}

// RP's published per-muscle MRV, used to seed MesocycleCyclicSetChange.maxVolume
// instead of the app UI's flat 30 for every muscle. Sources are in the vault at
// "09-HEALTH & FITNESS/Dead Lifts progression scheme.md" (gap table row 7).
// Values are the top of RP's published MRV range, sets per week.
export const RP_MRV: Record<MuscleGroup, number> = {
	Chest: 26,
	FrontDelts: 20,
	SideDelts: 26,
	RearDelts: 26,
	Lats: 32,
	Traps: 26,
	Triceps: 26,
	Biceps: 26,
	Forearms: 20,
	Quads: 28,
	Hamstrings: 24,
	Glutes: 24,
	Calves: 24,
	Abs: 25,
	Neck: 16,
	Adductors: 20,
	Abductors: 20,
	Custom: 30
};

// RP's MEV, sets per week — the per-muscle starting volume for a block.
export const RP_MEV: Record<MuscleGroup, number> = {
	Chest: 10,
	FrontDelts: 6,
	SideDelts: 10,
	RearDelts: 10,
	Lats: 12,
	Traps: 8,
	Triceps: 8,
	Biceps: 8,
	Forearms: 6,
	Quads: 10,
	Hamstrings: 8,
	Glutes: 8,
	Calves: 10,
	Abs: 8,
	Neck: 6,
	Adductors: 6,
	Abductors: 6,
	Custom: 6
};

export type RawExercise = {
	name: string;
	muscle: string;
	setType?: SetType;
	repRangeStart?: number;
	repRangeEnd?: number;
	bodyweightFraction?: number;
	note?: string;
	topRepRangeStart?: number;
	topRepRangeEnd?: number;
};

export type RawDay = { name: string; isRestDay?: boolean; exercises?: RawExercise[] };
export type RawSplit = { name: string; days: RawDay[] };

export type MappedExercise = {
	name: string;
	exerciseIndex: number;
	targetMuscleGroup: MuscleGroup;
	customMuscleGroup: string | null;
	bodyweightFraction: number | null;
	setType: SetType;
	repRangeStart: number;
	repRangeEnd: number;
	changeType: null;
	changeAmount: null;
	note: string | null;
	topRepRangeStart: number | null;
	topRepRangeEnd: number | null;
	/** True when setType fell back to the Straight default. Counted, not flagged per-line. */
	setTypeDefaulted: boolean;
	/** Human-readable notes about anything auto-filled or guessed. */
	flags: string[];
};

export type MappedDay = { name: string; dayIndex: number; isRestDay: boolean; exercises: MappedExercise[] };
export type MappedSplit = { name: string; days: MappedDay[] };

export function mapSplit(raw: RawSplit): MappedSplit {
	if (!raw.name?.trim()) throw new Error('Split has no name.');
	if (!Array.isArray(raw.days) || raw.days.length === 0) throw new Error('Split has no days.');

	return {
		name: raw.name.trim(),
		days: raw.days.map((day, dayIndex) => {
			const isRestDay = day.isRestDay ?? !day.exercises?.length;
			const exercises = (isRestDay ? [] : (day.exercises ?? [])).map((ex, exerciseIndex) => {
				const flags: string[] = [];

				if (!ex.name?.trim()) throw new Error(`Day ${dayIndex} exercise ${exerciseIndex} has no name.`);
				const { group, custom, matched } = resolveMuscleGroup(ex.muscle ?? '');
				if (!matched) flags.push(`muscle "${ex.muscle}" not in enum -> Custom`);

				const [defStart, defEnd] = defaultRepRange(ex.name);
				const repRangeStart = ex.repRangeStart ?? defStart;
				const repRangeEnd = ex.repRangeEnd ?? defEnd;
				if (ex.repRangeStart === undefined || ex.repRangeEnd === undefined) {
					flags.push(
						`rep range auto-filled ${repRangeStart}-${repRangeEnd} (${isCompound(ex.name) ? 'compound' : 'isolation'})`
					);
				}
				if (repRangeStart > repRangeEnd) throw new Error(`${ex.name}: repRangeStart > repRangeEnd`);

				const setType = ex.setType ?? 'Straight';
				if (!SET_TYPES.includes(setType)) throw new Error(`${ex.name}: unknown setType "${setType}"`);
				const setTypeDefaulted = ex.setType === undefined;

				return {
					name: ex.name.trim(),
					exerciseIndex,
					targetMuscleGroup: group,
					customMuscleGroup: custom,
					bodyweightFraction: ex.bodyweightFraction ?? null,
					setType,
					repRangeStart,
					repRangeEnd,
					changeType: null,
					changeAmount: null,
					note: ex.note ?? null,
					topRepRangeStart: ex.topRepRangeStart ?? null,
					topRepRangeEnd: ex.topRepRangeEnd ?? null,
					setTypeDefaulted,
					flags
				} satisfies MappedExercise;
			});

			return { name: day.name?.trim() || `Day ${dayIndex + 1}`, dayIndex, isRestDay, exercises };
		})
	};
}

export function renderSplitTable(split: MappedSplit): string {
	const out: string[] = [];
	out.push(`SPLIT: ${split.name}`);
	out.push(
		`${split.days.length} days, ${split.days.filter((d) => !d.isRestDay).length} training / ${split.days.filter((d) => d.isRestDay).length} rest`
	);
	out.push('');

	const flagged: string[] = [];
	for (const day of split.days) {
		if (day.isRestDay) {
			out.push(`  [${day.dayIndex}] ${day.name}  — REST`);
			continue;
		}
		out.push(`  [${day.dayIndex}] ${day.name}`);
		out.push(`       ${'#'.padEnd(3)}${'EXERCISE'.padEnd(34)}${'MUSCLE'.padEnd(13)}${'REPS'.padEnd(8)}TYPE`);
		for (const ex of day.exercises) {
			const muscle = ex.customMuscleGroup ? `*${ex.customMuscleGroup}` : ex.targetMuscleGroup;
			out.push(
				`       ${String(ex.exerciseIndex + 1).padEnd(3)}${ex.name.slice(0, 33).padEnd(34)}${muscle.slice(0, 12).padEnd(13)}${`${ex.repRangeStart}-${ex.repRangeEnd}`.padEnd(8)}${ex.setType}`
			);
			for (const f of ex.flags) flagged.push(`  ${day.name} / ${ex.name}: ${f}`);
		}
		out.push('');
	}

	// Per-muscle set-slot count. Not sets-per-week — a split carries no set
	// counts. This is how many exercise slots hit each muscle across the split,
	// which is what the mesocycle builder will distribute start volume across.
	const perMuscle = new Map<string, number>();
	for (const day of split.days) {
		for (const ex of day.exercises) {
			const key = ex.customMuscleGroup ?? ex.targetMuscleGroup;
			perMuscle.set(key, (perMuscle.get(key) ?? 0) + 1);
		}
	}
	out.push('  EXERCISE SLOTS PER MUSCLE (not sets — a split has no set counts):');
	for (const [m, n] of [...perMuscle.entries()].sort((a, b) => b[1] - a[1])) {
		out.push(`       ${m.padEnd(14)}${n}`);
	}
	out.push('');

	const straightCount = split.days.flatMap((d) => d.exercises).filter((e) => e.setTypeDefaulted).length;
	if (straightCount) out.push(`  ${straightCount} exercise(s) took the default setType Straight.`);

	if (flagged.length) {
		out.push('');
		out.push(`  ⚠ ${flagged.length} AUTO-FILLED / GUESSED VALUE(S) — check these:`);
		out.push(...flagged);
	} else {
		out.push('  No rep ranges or muscle groups were guessed.');
	}

	return out.join('\n');
}

export function loadSplitFile(path: string): RawSplit {
	return JSON.parse(readFileSync(path, 'utf8')) as RawSplit;
}

/** Owns the single PrismaClient a standalone script is allowed, and disconnects it. */
export async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
	const prisma = new PrismaClient();
	try {
		return await fn(prisma);
	} finally {
		await prisma.$disconnect();
	}
}

export async function resolveUserId(prisma: PrismaClient, email: string): Promise<string> {
	const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
	if (!user)
		throw new Error(`No User row for ${email}. They must sign in through Cloudflare Access at least once first.`);
	return user.id;
}
