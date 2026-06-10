import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import type { Cookies } from '@sveltejs/kit';

export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

export function sessionCookieName(secure: boolean) {
	return secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

export async function getOrCreateOwner() {
	const email = env.APP_USER_EMAIL ?? 'owner@selfhosted.local';
	return prisma.user.upsert({
		where: { email },
		update: {},
		create: { email, name: env.APP_USER_NAME ?? 'Owner' }
	});
}

export async function mintSession(cookies: Cookies, secure: boolean) {
	const user = await getOrCreateOwner();
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
