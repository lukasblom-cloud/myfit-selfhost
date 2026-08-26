import { json } from '@sveltejs/kit';
import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { arraySum } from '$lib/utils';
import { getRIRForWeek } from '$lib/utils/workoutUtils';

// Read-only mesocycle state for the companion calendar's training overlay.
// Token-gated, and CORS-opened to COTSWORTH_ALLOWED_ORIGIN plus localhost.
// The calendar's origin, supplied by env so a personal hostname isn't baked
// into published source. Unset means only localhost gets through CORS.
const ALLOWED_ORIGIN = env.COTSWORTH_ALLOWED_ORIGIN ?? '';

// Localhost is allowed as well as the deployed calendar. CORS is not the gate
// here — the token in the query string is, and a non-browser client ignores
// CORS entirely — so this widens nothing security-relevant. It does make the
// overlay testable from a dev server, which it otherwise is not.
function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return false;
	if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) return true;
	return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null) {
	return {
		'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin! : ALLOWED_ORIGIN || 'null',
		'Vary': 'Origin',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization'
	};
}

export const OPTIONS = async ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const GET = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const token = url.searchParams.get('token') ?? request.headers.get('authorization')?.replace('Bearer ', '');
	if (!env.COTSWORTH_API_TOKEN || token !== env.COTSWORTH_API_TOKEN) {
		return json({ error: 'unauthorised' }, { status: 401, headers: corsHeaders(origin) });
	}

	// This feed is the owner's own training state, not whoever happens to have an
	// active mesocycle. With Crew sharing there are other users in this DB, so
	// both queries below must be scoped or they leak someone else's block.
	const ownerEmail = env.APP_USER_EMAIL?.toLowerCase();
	if (!ownerEmail) return json({ error: 'owner not configured' }, { status: 500, headers: corsHeaders(origin) });

	const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
	if (!owner) return json({ active: false }, { headers: corsHeaders(origin) });

	const lastWorkout = await prisma.workout.findFirst({
		where: { userId: owner.id },
		orderBy: { startedAt: 'desc' },
		select: { startedAt: true }
	});

	// Weekly volume. This is what health.lifting_weekly_volume existed to answer;
	// serving it here instead means the calendar can actually consume it, which
	// the cross-schema view never made possible (different Supabase project).
	const weekStart = new Date();
	weekStart.setHours(0, 0, 0, 0);
	weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // back to Monday

	const setsOfWeek = await prisma.workoutExerciseSet.findMany({
		where: {
			skipped: false,
			workoutExercise: { workout: { userId: owner.id, startedAt: { gte: weekStart } } }
		},
		select: {
			reps: true,
			load: true,
			workoutExercise: { select: { targetMuscleGroup: true, customMuscleGroup: true } }
		}
	});

	const byMuscle = new Map<string, { sets: number; tonnage: number }>();
	for (const s of setsOfWeek) {
		const key = s.workoutExercise.customMuscleGroup ?? s.workoutExercise.targetMuscleGroup;
		const cur = byMuscle.get(key) ?? { sets: 0, tonnage: 0 };
		cur.sets += 1;
		cur.tonnage += s.reps * s.load;
		byMuscle.set(key, cur);
	}

	const weeklyVolume = {
		weekStart: weekStart.toISOString().slice(0, 10),
		sets: setsOfWeek.length,
		tonnage: Math.round(setsOfWeek.reduce((a, s) => a + s.reps * s.load, 0)),
		byMuscle: [...byMuscle.entries()]
			.map(([muscleGroup, v]) => ({ muscleGroup, sets: v.sets, tonnage: Math.round(v.tonnage) }))
			.sort((a, b) => b.sets - a.sets)
	};

	const meso = await prisma.mesocycle.findFirst({
		where: { userId: owner.id, startDate: { not: null }, endDate: null },
		include: {
			_count: { select: { workoutsOfMesocycle: true } },
			mesocycleExerciseSplitDays: { select: { isRestDay: true } }
		}
	});

	// No active block is not "no data" — weekly volume and the last session are
	// still true and the calendar still wants them.
	if (!meso) {
		return json(
			{ active: false, lastWorkoutAt: lastWorkout?.startedAt ?? null, weeklyVolume },
			{ headers: corsHeaders(origin) }
		);
	}

	// RIRProgression is indexed BY RIR value, and each element is how many weeks
	// are spent at that RIR — so the block length is the sum, not the length, and
	// this week's RIR needs getRIRForWeek, not an index by week number.
	const totalWeeks = arraySum(meso.RIRProgression);
	const daysIn = Math.floor((Date.now() - meso.startDate!.getTime()) / 86_400_000);
	const weekNumber = Math.min(Math.floor(daysIn / 7) + 1, totalWeeks);

	return json(
		{
			active: true,
			name: meso.name,
			startDate: meso.startDate,
			weekNumber,
			totalWeeks,
			currentRIR: getRIRForWeek(meso.RIRProgression, weekNumber),
			workoutsLogged: meso._count.workoutsOfMesocycle,
			trainingDaysPerWeek: meso.mesocycleExerciseSplitDays.filter((d) => !d.isRestDay).length,
			lastWorkoutAt: lastWorkout?.startedAt ?? null,
			weeklyVolume
		},
		{ headers: corsHeaders(origin) }
	);
};
