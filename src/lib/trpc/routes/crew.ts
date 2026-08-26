import { prisma } from '$lib/prisma';
import { z } from 'zod';
import { t } from '$lib/trpc/t';
import { TRPCError } from '@trpc/server';
import { arraySum } from '$lib/utils';
import { getRIRForWeek } from '$lib/utils/workoutUtils';

// Crew sharing — not in upstream MyFit.
//
// READ-ONLY BY CONSTRUCTION. Every query below either scopes to ctx.userId
// (my own grants) or goes through assertCanView() first (someone else's data).
// There is deliberately no mutation in this router that writes to a row owned
// by anyone other than the caller — a viewer cannot edit crew data because the
// API to do it does not exist, not because the UI hides the button.

const emailSchema = z.string().trim().toLowerCase().email('That does not look like an email address.');

/** Throws unless `viewerId` holds a live grant from `ownerId`. */
async function assertCanView(viewerId: string, ownerId: string) {
	if (viewerId === ownerId) return;
	const grant = await prisma.sharedAccess.findFirst({
		where: { ownerId, viewerId },
		select: { id: true }
	});
	if (!grant) throw new TRPCError({ code: 'FORBIDDEN', message: 'They have not shared their training with you.' });
}

/** Monday 00:00 of the week containing `now`, local to the server. */
function startOfWeek(now = new Date()) {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	// getDay(): 0 = Sunday. Shift so Monday is the first day.
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d;
}

/** The crew card for one owner. Summary-scope data only. */
async function buildSummary(ownerId: string) {
	const weekStart = startOfWeek();

	const [meso, lastWorkout, setsThisWeek] = await Promise.all([
		prisma.mesocycle.findFirst({
			where: { userId: ownerId, startDate: { not: null }, endDate: null },
			select: {
				name: true,
				startDate: true,
				RIRProgression: true,
				_count: { select: { workoutsOfMesocycle: true } }
			}
		}),
		prisma.workout.findFirst({
			where: { userId: ownerId },
			orderBy: { startedAt: 'desc' },
			select: { startedAt: true }
		}),
		prisma.workoutExerciseSet.count({
			where: {
				skipped: false,
				workoutExercise: { workout: { userId: ownerId, startedAt: { gte: weekStart } } }
			}
		})
	]);

	let mesocycle: {
		name: string;
		weekNumber: number;
		totalWeeks: number;
		currentRIR: number;
		workoutsLogged: number;
	} | null = null;

	if (meso?.startDate) {
		// RIRProgression is indexed BY RIR value; each element is the number of
		// weeks spent at that RIR. Length is the number of distinct RIR levels,
		// NOT the block length — that's the sum.
		const totalWeeks = arraySum(meso.RIRProgression);
		const daysIn = Math.floor((Date.now() - meso.startDate.getTime()) / 86_400_000);
		const weekNumber = Math.min(Math.max(Math.floor(daysIn / 7) + 1, 1), Math.max(totalWeeks, 1));
		mesocycle = {
			name: meso.name,
			weekNumber,
			totalWeeks,
			currentRIR: getRIRForWeek(meso.RIRProgression, weekNumber),
			workoutsLogged: meso._count.workoutsOfMesocycle
		};
	}

	return {
		mesocycle,
		lastWorkoutAt: lastWorkout?.startedAt ?? null,
		setsThisWeek,
		trainedThisWeek: setsThisWeek > 0
	};
}

export const crew = t.router({
	/// Everyone who has shared their training WITH ME, plus their current state.
	sharedWithMe: t.procedure.query(async ({ ctx }) => {
		const grants = await prisma.sharedAccess.findMany({
			where: { viewerId: ctx.userId },
			orderBy: { createdAt: 'asc' },
			select: {
				id: true,
				scope: true,
				createdAt: true,
				owner: { select: { id: true, name: true, email: true, image: true } }
			}
		});

		return Promise.all(
			grants.map(async (g) => ({
				grantId: g.id,
				scope: g.scope,
				since: g.createdAt,
				user: g.owner,
				...(await buildSummary(g.owner.id))
			}))
		);
	}),

	/// My own card, so the Crew page can show me alongside everyone else.
	me: t.procedure.query(async ({ ctx }) => {
		const user = await prisma.user.findUniqueOrThrow({
			where: { id: ctx.userId },
			select: { id: true, name: true, email: true, image: true }
		});
		return { user, ...(await buildSummary(ctx.userId)) };
	}),

	/// The grants I have handed out. `pending` means that email has never signed
	/// in, so the grant is real but dormant.
	myGrants: t.procedure.query(async ({ ctx }) => {
		const grants = await prisma.sharedAccess.findMany({
			where: { ownerId: ctx.userId },
			orderBy: { createdAt: 'asc' },
			select: {
				id: true,
				viewerEmail: true,
				viewerId: true,
				scope: true,
				createdAt: true,
				viewer: { select: { name: true, email: true, image: true } }
			}
		});
		return grants.map((g) => ({ ...g, pending: g.viewerId === null }));
	}),

	/// Grant read access to an email. Keyed on email so it works for someone who
	/// has never logged in — it activates itself when they first sign in.
	grant: t.procedure
		.input(z.strictObject({ email: emailSchema, scope: z.enum(['Summary', 'Sessions']).default('Summary') }))
		.mutation(async ({ input, ctx }) => {
			const me = await prisma.user.findUniqueOrThrow({
				where: { id: ctx.userId },
				select: { email: true }
			});
			if (me.email.toLowerCase() === input.email) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You already have access to your own training.' });
			}

			// Resolve to a User row now if they already exist; otherwise leave
			// viewerId null and let getOrCreateUser backfill it on first sign-in.
			const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });

			await prisma.sharedAccess.upsert({
				where: { ownerId_viewerEmail: { ownerId: ctx.userId, viewerEmail: input.email } },
				update: { scope: input.scope, viewerId: existing?.id ?? null },
				create: { ownerId: ctx.userId, viewerEmail: input.email, viewerId: existing?.id ?? null, scope: input.scope }
			});

			return {
				message: existing
					? `${input.email} can now see your training.`
					: `Invited ${input.email}. The grant activates the first time they sign in.`,
				pending: !existing
			};
		}),

	/// Revoke a grant I made. Scoped to ownerId so this can only ever delete my
	/// own row — a viewer cannot revoke someone else's grant.
	revoke: t.procedure.input(z.string().cuid2()).mutation(async ({ input, ctx }) => {
		const deleted = await prisma.sharedAccess.deleteMany({ where: { id: input, ownerId: ctx.userId } });
		if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such grant.' });
		return { message: 'Access revoked.' };
	}),

	/// Stop seeing someone's training. The viewer's own way out, without needing
	/// the owner to act. Scoped to viewerId for the same reason as above.
	leave: t.procedure.input(z.string().cuid2()).mutation(async ({ input, ctx }) => {
		const deleted = await prisma.sharedAccess.deleteMany({ where: { id: input, viewerId: ctx.userId } });
		if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such grant.' });
		return { message: 'Removed from your crew.' };
	}),

	/// Recent sessions for one crew member. Requires Sessions scope.
	sessionsOf: t.procedure
		.input(z.strictObject({ ownerId: z.string().cuid2(), take: z.number().min(1).max(50).default(10) }))
		.query(async ({ input, ctx }) => {
			await assertCanView(ctx.userId, input.ownerId);

			if (ctx.userId !== input.ownerId) {
				const grant = await prisma.sharedAccess.findFirst({
					where: { ownerId: input.ownerId, viewerId: ctx.userId },
					select: { scope: true }
				});
				if (grant?.scope !== 'Sessions') {
					throw new TRPCError({ code: 'FORBIDDEN', message: 'They only shared their summary, not sessions.' });
				}
			}

			const workouts = await prisma.workout.findMany({
				where: { userId: input.ownerId },
				orderBy: { startedAt: 'desc' },
				take: input.take,
				select: {
					id: true,
					startedAt: true,
					endedAt: true,
					workoutOfMesocycle: { select: { splitDayIndex: true, workoutStatus: true } },
					workoutExercises: {
						orderBy: { exerciseIndex: 'asc' },
						select: {
							name: true,
							targetMuscleGroup: true,
							customMuscleGroup: true,
							_count: { select: { sets: true } }
						}
					}
				}
			});

			return workouts.map((w) => ({
				id: w.id,
				startedAt: w.startedAt,
				durationMin: Math.round((w.endedAt.getTime() - w.startedAt.getTime()) / 60_000),
				status: w.workoutOfMesocycle?.workoutStatus ?? null,
				exercises: w.workoutExercises.map((e) => ({
					name: e.name,
					muscleGroup: e.customMuscleGroup ?? e.targetMuscleGroup,
					sets: e._count.sets
				}))
			}));
		})
});
