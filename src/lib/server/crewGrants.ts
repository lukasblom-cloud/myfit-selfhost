import { prisma } from '$lib/prisma';

// Crew grants are keyed on EMAIL rather than on a User row, so an owner can
// share with someone who has never logged in. This is where a dormant grant
// becomes a live one.
//
// Deliberately kept in its own module, importing nothing but the Prisma
// singleton — no `$env`, no SvelteKit runtime — so it can be exercised
// directly by scripts/dev/crew-smoke.ts without booting the app.
export async function bindPendingGrants(email: string, userId: string) {
	const { count } = await prisma.sharedAccess.updateMany({
		where: { viewerEmail: email.trim().toLowerCase(), viewerId: null },
		data: { viewerId: userId }
	});
	return count;
}
