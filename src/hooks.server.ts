import { SvelteKitAuth } from '@auth/sveltekit';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '$lib/prisma';
import { createContext } from '$lib/trpc/context';
import { router } from '$lib/trpc/router';
import { createTRPCHandle } from 'trpc-sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyAccessJwt } from '$lib/server/cfAccess';
import { getOrCreateUser, mintSessionForUser } from '$lib/server/singleUserSession';

// Who is allowed in via Cloudflare Access. Cloudflare's own Access policy is
// the primary gate; this is a second app-level gate so membership can also be
// controlled from the app env. Comma-separated emails, or `*` to trust
// whatever Access verified. Falls back to owner-only if unset (back-compat).
function allowedAccessEmails(): string[] {
	const list = env.CF_ACCESS_ALLOWED_EMAILS ?? env.APP_USER_EMAIL ?? 'owner@selfhosted.local';
	return list
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
}

function isAccessEmailAllowed(email: string): boolean {
	const allow = allowedAccessEmails();
	return allow.includes('*') || allow.includes(email.toLowerCase());
}

// Self-hosted single-user build: no OAuth providers. Sessions are still
// resolved through the Prisma adapter; rows are minted by /login or the
// Cloudflare Access handle below.
const { handle: authHandle } = SvelteKitAuth({
	adapter: PrismaAdapter(prisma),
	basePath: '/auth',
	providers: [],
	trustHost: true,
	callbacks: {
		session({ session, user }) {
			session.userId = user.id;
			return session;
		}
	}
});

// SSO via Cloudflare Access: requests arriving through the proxied domain
// carry a team-signed JWT. If there's no app session yet, verify it, mint a
// session row + cookie, and answer locals.auth() directly for this request.
const cfAccessHandle: Handle = async ({ event, resolve }) => {
	const existing = await event.locals.auth();
	if (!existing) {
		const jwt = event.request.headers.get('cf-access-jwt-assertion');
		if (jwt) {
			const payload = await verifyAccessJwt(jwt);
			const email = payload?.email as string | undefined;
			if (email && isAccessEmailAllowed(email)) {
				const secure = event.url.protocol === 'https:';
				const name = (payload?.name ?? payload?.given_name) as string | undefined;
				const user = await getOrCreateUser(email, name);
				const { expires } = await mintSessionForUser(user, event.cookies, secure);
				const session = {
					user: { id: user.id, name: user.name, email: user.email, image: user.image },
					userId: user.id,
					expires: expires.toISOString()
				};
				event.locals.auth = async () => session;
			}
		}
	}
	return resolve(event);
};

const trpcHandle = createTRPCHandle({
	router,
	createContext,
	onError: ({ type, path, error }) =>
		console.error(`Encountered error while trying to process ${type} @ ${path}:`, error)
});

export const handle = sequence(authHandle, cfAccessHandle, trpcHandle);
