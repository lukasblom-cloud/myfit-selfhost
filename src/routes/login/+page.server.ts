import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/prisma';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';

export const load = async ({ locals }) => {
	const session = await locals.auth();
	if (session) redirect(302, '/');
};

export const actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const password = data.get('password');
		if (!env.APP_PASSWORD || password !== env.APP_PASSWORD) {
			return fail(401, { incorrect: true });
		}

		const email = env.APP_USER_EMAIL ?? 'owner@selfhosted.local';
		const user = await prisma.user.upsert({
			where: { email },
			update: {},
			create: { email, name: env.APP_USER_NAME ?? 'Owner' }
		});

		const sessionToken = randomUUID();
		const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
		await prisma.session.create({
			data: { sessionToken, expires, userId: user.id }
		});

		const secure = url.protocol === 'https:';
		cookies.set(secure ? '__Secure-authjs.session-token' : 'authjs.session-token', sessionToken, {
			path: '/',
			httpOnly: true,
			secure,
			sameSite: 'lax',
			expires
		});

		redirect(302, '/');
	}
};
