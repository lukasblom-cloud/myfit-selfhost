import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import type { User } from '@prisma/client';
import { bindPendingGrants } from '$lib/server/crewGrants';

export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

export function sessionCookieName(secure: boolean) {
	return secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

// Upsert the user identified by `email`. Used by both the Cloudflare Access
// SSO path (email from the verified JWT) and the /login owner fallback. Each
// distinct email gets its own User row — all workout data is already scoped
// per userId, so this is all multi-user needs on the auth side.
export async function getOrCreateUser(rawEmail: string, name?: string) {
	// Normalise before touching the DB. User.email is a case-SENSITIVE unique, so
	// an identity provider that sends "Sam.Example@Example.com" one day and
	// "sam.example@example.com" the next would silently create two separate
	// accounts with two separate training histories. Crew grants are stored
	// lowercased too, so this is also what makes an invite match its user.
	const email = rawEmail.trim().toLowerCase();

	const user = await prisma.user.upsert({
		where: { email },
		update: {},
		create: { email, name: name ?? email.split('@')[0] }
	});

	// Activate any crew grant that was handed out to this email before they had
	// an account. Idempotent, and the only place it happens.
	await bindPendingGrants(email, user.id);

	return user;
}

// The owner identity used by the /login password fallback (break-glass door
// that works even if Cloudflare Access is misconfigured).
export async function getOrCreateOwner() {
	const email = env.APP_USER_EMAIL ?? 'owner@selfhosted.local';
	return getOrCreateUser(email, env.APP_USER_NAME ?? 'Owner');
}

// Create a session row + cookie for an already-resolved user.
export async function mintSessionForUser(user: User, cookies: Cookies, secure: boolean) {
	const sessionToken = randomUUID();
	const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
	await prisma.session.create({
		data: { sessionToken, expires, userId: user.id }
	});
	cookies.set(sessionCookieName(secure), sessionToken, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		expires
	});
	return { user, expires };
}

// Mint a session for the owner (used by the /login password fallback).
export async function mintSession(cookies: Cookies, secure: boolean) {
	const user = await getOrCreateOwner();
	return mintSessionForUser(user, cookies, secure);
}
