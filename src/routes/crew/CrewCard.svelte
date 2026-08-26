<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Avatar from '$lib/components/ui/avatar';

	type Summary = {
		user: { id: string; name: string | null; email: string; image: string | null };
		mesocycle: {
			name: string;
			weekNumber: number;
			totalWeeks: number;
			currentRIR: number;
			workoutsLogged: number;
		} | null;
		lastWorkoutAt: Date | null;
		setsThisWeek: number;
		trainedThisWeek: boolean;
	};

	let { summary, isMe = false }: { summary: Summary; isMe?: boolean } = $props();

	const displayName = $derived(summary.user.name ?? summary.user.email.split('@')[0]);
	const initials = $derived(displayName.slice(0, 2).toUpperCase());

	function relativeDay(d: Date | null) {
		if (!d) return 'never';
		const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days} days ago`;
		if (days < 14) return 'last week';
		return `${Math.floor(days / 7)} weeks ago`;
	}
</script>

<Card.Root>
	<Card.Header class="flex-row items-center gap-3 space-y-0 pb-3">
		<Avatar.Root class="h-9 w-9">
			{#if summary.user.image}<Avatar.Image alt={displayName} src={summary.user.image} />{/if}
			<Avatar.Fallback class="text-xs">{initials}</Avatar.Fallback>
		</Avatar.Root>
		<div class="min-w-0 flex-1">
			<Card.Title class="truncate text-base">
				{displayName}
				{#if isMe}<span class="text-sm font-normal text-muted-foreground">(you)</span>{/if}
			</Card.Title>
			<p class="truncate text-xs text-muted-foreground">{summary.user.email}</p>
		</div>
		<Badge variant={summary.trainedThisWeek ? 'default' : 'outline'}>
			{summary.trainedThisWeek ? 'Trained this week' : 'Nothing this week'}
		</Badge>
	</Card.Header>

	<Card.Content class="pt-0">
		{#if summary.mesocycle}
			<p class="truncate font-medium">{summary.mesocycle.name}</p>
			<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
				<div>
					<dt class="text-xs text-muted-foreground">Week</dt>
					<dd>{summary.mesocycle.weekNumber} of {summary.mesocycle.totalWeeks}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Target RIR</dt>
					<dd>{summary.mesocycle.currentRIR}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Sets this week</dt>
					<dd>{summary.setsThisWeek}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Last session</dt>
					<dd>{relativeDay(summary.lastWorkoutAt)}</dd>
				</div>
			</dl>
		{:else}
			<p class="text-sm text-muted-foreground">
				No active mesocycle.
				{#if summary.lastWorkoutAt}
					Last trained {relativeDay(summary.lastWorkoutAt)}.
				{:else}
					Hasn't logged a workout yet.
				{/if}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
