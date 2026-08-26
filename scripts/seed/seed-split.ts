// Seed an ExerciseSplit into the live DB from a JSON file.
//
//   npx tsx scripts/seed/seed-split.ts <file.json>            # dry run (default)
//   npx tsx scripts/seed/seed-split.ts <file.json> --write
//   npx tsx scripts/seed/seed-split.ts <file.json> --write --user someone@example.com
//
// Mirrors createOrEditExerciseSplit in src/lib/trpc/routes/exerciseSplits.ts:
// same three createMany calls inside one $transaction, same cuid2 ids.
// Writes go over the transaction pooler (6543) from .env — that's correct for
// DML. Never point this at the session pooler.

import { createId } from '@paralleldrive/cuid2';
import type { Prisma, ExerciseSplit, ExerciseSplitDay } from '@prisma/client';
import { loadSplitFile, mapSplit, renderSplitTable, withPrisma, resolveUserId, type MappedSplit } from './lib.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');
const userEmail =
	args.includes('--user') && args[args.indexOf('--user') + 1]
		? args[args.indexOf('--user') + 1]
		: process.env.APP_USER_EMAIL;
if (!userEmail) throw new Error('Pass --user <email>, or set APP_USER_EMAIL in .env.');

if (!file) {
	console.error('Usage: tsx scripts/seed/seed-split.ts <file.json> [--write] [--user <email>]');
	process.exit(1);
}

const mapped = mapSplit(loadSplitFile(file));

console.log('');
console.log(renderSplitTable(mapped));
console.log('');

if (!write) {
	console.log(`DRY RUN — nothing written. Target account would be: ${userEmail}`);
	console.log('Re-run with --write to commit.');
	process.exit(0);
}

await withPrisma(async (prisma) => {
	const userId = await resolveUserId(prisma, userEmail);

	const existing = await prisma.exerciseSplit.findFirst({ where: { userId, name: mapped.name }, select: { id: true } });
	if (existing) {
		console.error(`A split named "${mapped.name}" already exists for ${userEmail} (${existing.id}).`);
		console.error('Rename it in the JSON, or delete the existing one in the app first. Refusing to duplicate.');
		process.exit(1);
	}

	const splitId = createId();
	const split: ExerciseSplit = { id: splitId, name: mapped.name, userId };

	const days: ExerciseSplitDay[] = mapped.days.map((d) => ({
		id: createId(),
		name: d.name,
		dayIndex: d.dayIndex,
		isRestDay: d.isRestDay,
		exerciseSplitId: splitId
	}));

	const templates: Prisma.ExerciseTemplateUncheckedCreateInput[] = mapped.days.flatMap((d, i) =>
		d.exercises.map(({ flags, setTypeDefaulted, ...ex }) => ({ ...ex, id: createId(), exerciseSplitDayId: days[i].id }))
	);

	await prisma.$transaction([
		prisma.exerciseSplit.create({ data: split }),
		prisma.exerciseSplitDay.createMany({ data: days }),
		prisma.exerciseTemplate.createMany({ data: templates })
	]);

	console.log(`WROTE split "${mapped.name}" (${splitId})`);
	console.log(`  ${days.length} days, ${templates.length} exercise templates, owner ${userEmail}`);
	console.log('');
	console.log('Next: build a mesocycle from it —');
	console.log(`  npx tsx scripts/seed/seed-mesocycle.ts --split "${mapped.name}"`);
});
