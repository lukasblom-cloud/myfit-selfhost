import { json } from '@sveltejs/kit';
import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { arraySum } from '$lib/utils';
import { getRIRForWeek } from '$lib/utils/workoutUtils';

// Read-only mesocycle state for the Cotsworth calendar's training overlay.
// Token-gated (matches Cotsworth's existing VITE_*_API + token pattern) and
// CORS-opened to the calendar origin plus localhost (see isAllowedOrigin).
const ALLOWED_ORIGIN = 'https://calendar.example.com';

// Localhost is allowed as well as the deployed calendar. CORS is not the gate
// here — the token in the query string is, and a non-browser client ignores
// CORS entirely — so this widens nothing security-relevant. It does make the
// overlay testable from a dev server, which it otherwise is not.
function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return false;
	if (origin === ALLOWED_ORIGIN) return true;
	return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null) {
	return {
		'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin! : ALLOWED_ORIGIN,
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

	const meso = await prisma.mesocycle.findFirst({
		where: { userId: owner.id, startDate: { not: null }, endDate: null },
		include: {
			_count: { select: { workoutsOfMesocycle: true } },
			mesocycleExerciseSplitDays: { select: { isRestDay: true } }
		}
	});

	if (!meso) return json({ active: false }, { headers: corsHeaders(origin) });

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
		{ headers: corsHeaders(origin) }
	);
};
