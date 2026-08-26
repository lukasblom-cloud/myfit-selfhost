import { json } from '@sveltejs/kit';
import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { arraySum } from '$lib/utils';
import { getRIRForWeek } from '$lib/utils/workoutUtils';

// Read-only mesocycle state for the Cotsworth calendar's training overlay.
// Token-gated (matches Cotsworth's existing VITE_*_API + token pattern) and
// CORS-opened to the calendar's origin only.
const ALLOWED_ORIGIN = 'https://calendar.example.com';

function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization'
	};
}

export const OPTIONS = async () => new Response(null, { status: 204, headers: corsHeaders() });

export const GET = async ({ url, request }) => {
	const token = url.searchParams.get('token') ?? request.headers.get('authorization')?.replace('Bearer ', '');
	if (!env.COTSWORTH_API_TOKEN || token !== env.COTSWORTH_API_TOKEN) {
		return json({ error: 'unauthorised' }, { status: 401, headers: corsHeaders() });
	}

	// This feed is the owner's own training state, not whoever happens to have an
	// active mesocycle. With Crew sharing there are other users in this DB, so
	// both queries below must be scoped or they leak someone else's block.
	const ownerEmail = env.APP_USER_EMAIL?.toLowerCase();
	if (!ownerEmail) return json({ error: 'owner not configured' }, { status: 500, headers: corsHeaders() });

	const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
	if (!owner) return json({ active: false }, { headers: corsHeaders() });

	const meso = await prisma.mesocycle.findFirst({
		where: { userId: owner.id, startDate: { not: null }, endDate: null },
		include: {
			_count: { select: { workoutsOfMesocycle: true } },
			mesocycleExerciseSplitDays: { select: { isRestDay: true } }
		}
	});

	if (!meso) return json({ active: false }, { headers: corsHeaders() });

	// RIRProgression is indexed BY RIR value, and each element is how many weeks
	// are spent at that RIR — so the block length is the sum, not the length, and
	// this week's RIR needs getRIRForWeek, not an index by week number.
	const totalWeeks = arraySum(meso.RIRProgression);
	const daysIn = Math.floor((Date.now() - meso.startDate!.getTime()) / 86_400_000);
	const weekNumber = Math.min(Math.floor(daysIn / 7) + 1, totalWeeks);
	const lastWorkout = await prisma.workout.findFirst({
		where: { userId: owner.id },
		orderBy: { startedAt: 'desc' },
		select: { startedAt: true }
	});

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
			lastWorkoutAt: lastWorkout?.startedAt ?? null
		},
		{ headers: corsHeaders() }
	);
};
