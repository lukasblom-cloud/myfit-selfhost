import { SvelteKitAuth } from '@auth/sveltekit';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '$lib/prisma';
import { createContext } from '$lib/trpc/context';
import { router } from '$lib/trpc/router';
import { createTRPCHandle } from 'trpc-sveltekit';
import { sequence } from '@sveltejs/kit/hooks';

// Self-hosted single-user build: no OAuth providers. Sessions are still
// resolved through the Prisma adapter; rows are minted by /login.
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

const trpcHandle = createTRPCHandle({
	router,
	createContext,
	onError: ({ type, path, error }) =>
		console.error(`Encountered error while trying to process ${type} @ ${path}:`, error)
});

export const handle = sequence(authHandle, trpcHandle);
