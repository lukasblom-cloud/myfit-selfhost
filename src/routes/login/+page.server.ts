import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { mintSession } from '$lib/server/singleUserSession';

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
		await mintSession(cookies, url.protocol === 'https:');
		redirect(302, '/');
	}
};
