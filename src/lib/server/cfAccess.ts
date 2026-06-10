import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '$env/dynamic/private';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

// Verifies a Cloudflare Access JWT against the Zero Trust team's public keys.
// Returns the payload on success, null on any failure. CF_ACCESS_AUD is
// optional but recommended — without it any app in the team is accepted.
export async function verifyAccessJwt(token: string): Promise<JWTPayload | null> {
	const team = env.CF_ACCESS_TEAM_DOMAIN;
	if (!team) return null;
	jwks ??= createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
	try {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: `https://${team}`,
			...(env.CF_ACCESS_AUD ? { audience: env.CF_ACCESS_AUD } : {})
		});
		return payload;
	} catch {
		return null;
	}
}
