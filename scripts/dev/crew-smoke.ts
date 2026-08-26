// Crew sharing smoke test — fixtures + session cookies, so the real tRPC router
// can be driven over HTTP without typing the /login break-glass password.
//
//   npx tsx scripts/dev/crew-smoke.ts setup              # fixtures + cookies
//   npx tsx scripts/dev/crew-smoke.ts token <email>      # mint one session cookie
//   npx tsx scripts/dev/crew-smoke.ts backfill <email>   # prove a pending grant activates
//   npx tsx scripts/dev/crew-smoke.ts teardown           # remove every fixture
//
// Test users live on example.invalid (RFC 2606 — can never be a real address),
// so teardown can match on the domain and cannot possibly delete a real user.

import { PrismaClient } from '@prisma/client';
import { bindPendingGrants } from '../../src/lib/server/crewGrants.js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../.env') });

const TEST_DOMAIN = '@example.invalid';
const OWNER = process.env.APP_USER_EMAIL?.toLowerCase() ?? 'owner@example.com';
const VIEWER = `crew-test-viewer${TEST_DOMAIN}`;
const STRANGER = `crew-test-stranger${TEST_DOMAIN}`;
const PENDING = `crew-test-pending${TEST_DOMAIN}`;

const cmd = process.argv[2] ?? 'setup';
const prisma = new PrismaClient();

try {
	if (cmd === 'token') {
		// Mint a session cookie for one test user, so the real router can be driven
		// over HTTP. Test-domain only — this must never mint a session for a real
		// account.
		const email = process.argv[3];
		if (!email?.endsWith(TEST_DOMAIN) && email !== OWNER) {
			throw new Error(`Refusing: token only mints for ${TEST_DOMAIN} addresses or the owner.`);
		}
		// NOTE: Auth.js rotates `expires` to now+30d the first time the cookie is
		// used, so the 1h below is not what you'll see in the DB afterwards. Find
		// these by createdAt, not by expiry, when cleaning up.
		const u = await prisma.user.findUniqueOrThrow({ where: { email } });
		const sessionToken = randomUUID();
		await prisma.session.create({ data: { sessionToken, expires: new Date(Date.now() + 3_600_000), userId: u.id } });
		process.stdout.write(sessionToken);
	} else if (cmd === 'backfill') {
		// Simulates what happens when a pending invitee signs in for the first
		// time: Cloudflare Access verifies them, getOrCreateUser creates the User
		// row, then calls bindPendingGrants — the real function, imported here.
		const email = process.argv[3];
		if (!email?.endsWith(TEST_DOMAIN)) throw new Error(`Refusing: backfill only runs on ${TEST_DOMAIN} addresses.`);

		const before = await prisma.sharedAccess.findMany({
			where: { viewerEmail: email },
			select: { id: true, viewerId: true }
		});
		const user = await prisma.user.upsert({
			where: { email },
			update: {},
			create: { email, name: 'Backfill Test' }
		});
		const bound = await bindPendingGrants(email, user.id);
		const after = await prisma.sharedAccess.findMany({
			where: { viewerEmail: email },
			select: { id: true, viewerId: true }
		});

		console.log(`before: ${before.map((g) => g.viewerId ?? 'null').join(', ') || '(no grants)'}`);
		console.log(`bindPendingGrants bound ${bound} grant(s)`);
		console.log(`after:  ${after.map((g) => g.viewerId ?? 'null').join(', ') || '(no grants)'}`);
		console.log(after.every((g) => g.viewerId === user.id) ? 'PASS — every grant now bound to the new user.' : 'FAIL');
	} else if (cmd === 'teardown') {
		const users = await prisma.user.findMany({
			where: { email: { endsWith: TEST_DOMAIN } },
			select: { id: true, email: true }
		});
		// Belt and braces: never delete anything that isn't on the test domain.
		const ids = users.filter((u) => u.email.endsWith(TEST_DOMAIN)).map((u) => u.id);

		const grants = await prisma.sharedAccess.deleteMany({ where: { viewerEmail: { endsWith: TEST_DOMAIN } } });
		const deleted = ids.length ? await prisma.user.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };

		console.log(`teardown: ${deleted.count} test user(s), ${grants.count} test grant(s) removed.`);
		users.forEach((u) => console.log(`  - ${u.email}`));
	} else {
		const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER } });
		const viewer = await prisma.user.upsert({
			where: { email: VIEWER },
			update: {},
			create: { email: VIEWER, name: 'Test Viewer' }
		});
		const stranger = await prisma.user.upsert({
			where: { email: STRANGER },
			update: {},
			create: { email: STRANGER, name: 'Test Stranger' }
		});

		// Owner -> viewer, Summary scope. Stranger deliberately gets nothing.
		await prisma.sharedAccess.upsert({
			where: { ownerId_viewerEmail: { ownerId: owner.id, viewerEmail: VIEWER } },
			update: { viewerId: viewer.id, scope: 'Summary' },
			create: { ownerId: owner.id, viewerEmail: VIEWER, viewerId: viewer.id, scope: 'Summary' }
		});

		// A grant to somebody who has never signed in — exercises the pending path
		// and the backfill in getOrCreateUser.
		await prisma.sharedAccess.upsert({
			where: { ownerId_viewerEmail: { ownerId: owner.id, viewerEmail: PENDING } },
			update: { viewerId: null },
			create: { ownerId: owner.id, viewerEmail: PENDING, viewerId: null }
		});

		const expires = new Date(Date.now() + 3_600_000);
		const out: Record<string, string> = {};
		for (const [label, u] of Object.entries({ owner, viewer, stranger })) {
			const sessionToken = randomUUID();
			await prisma.session.create({ data: { sessionToken, expires, userId: u.id } });
			out[label] = sessionToken;
		}

		console.log(
			JSON.stringify({ ownerId: owner.id, viewerId: viewer.id, strangerId: stranger.id, cookies: out }, null, 2)
		);
	}
} finally {
	await prisma.$disconnect();
}
