<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc/client';
	import { page } from '$app/stores';
	import type { RouterOutputs } from '$lib/trpc/router';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import H2 from '$lib/components/ui/typography/H2.svelte';
	import H3 from '$lib/components/ui/typography/H3.svelte';
	import { toast } from 'svelte-sonner';
	import CrewCard from './CrewCard.svelte';
	import TrashIcon from 'virtual:icons/lucide/trash-2';
	import UserPlusIcon from 'virtual:icons/lucide/user-plus';

	type Me = RouterOutputs['crew']['me'];
	type SharedWithMe = RouterOutputs['crew']['sharedWithMe'];
	type MyGrants = RouterOutputs['crew']['myGrants'];

	let me: Me | undefined = $state(undefined);
	let crew: SharedWithMe | undefined = $state(undefined);
	let grants: MyGrants | undefined = $state(undefined);

	let inviteEmail = $state('');
	let inviteScope: 'Summary' | 'Sessions' = $state('Summary');
	let inviting = $state(false);

	async function refresh() {
		const client = trpc($page);
		[me, crew, grants] = await Promise.all([
			client.crew.me.query(),
			client.crew.sharedWithMe.query(),
			client.crew.myGrants.query()
		]);
	}

	onMount(refresh);

	async function invite() {
		if (!inviteEmail.trim()) return;
		inviting = true;
		try {
			const res = await trpc($page).crew.grant.mutate({ email: inviteEmail, scope: inviteScope });
			toast.success(res.message);
			inviteEmail = '';
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not add them.');
		} finally {
			inviting = false;
		}
	}

	async function revoke(id: string, email: string) {
		if (!confirm(`Stop sharing your training with ${email}?`)) return;
		try {
			toast.success((await trpc($page).crew.revoke.mutate(id)).message);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not revoke.');
		}
	}

	async function leave(id: string, name: string) {
		if (!confirm(`Remove ${name} from your crew? They keep their own data; you just stop seeing it.`)) return;
		try {
			toast.success((await trpc($page).crew.leave.mutate(id)).message);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not leave.');
		}
	}
</script>

<svelte:head><title>Crew</title></svelte:head>

<H2>Crew</H2>
<p class="text-sm text-muted-foreground">
	Everyone who has shared their training with you, and everyone you've shared yours with. Read-only both
	ways — nobody can edit anyone else's data.
</p>

<H3 class="mt-6">You</H3>
{#if me}
	<CrewCard isMe summary={me} />
{:else}
	<Skeleton class="h-32 w-full" />
{/if}

<H3 class="mt-6">Sharing with you</H3>
{#if crew === undefined}
	<Skeleton class="h-32 w-full" />
{:else if crew.length === 0}
	<p class="text-sm text-muted-foreground">Nobody has shared their training with you yet. Sharing is one-directional — if you've invited
		someone, they still need to invite you back before you can see theirs.</p>
{:else}
	<div class="flex flex-col gap-3">
		{#each crew as member (member.grantId)}
			<div class="relative">
				<CrewCard summary={member} />
				<Button
					class="absolute bottom-3 right-3 h-7 text-xs text-muted-foreground"
					onclick={() => leave(member.grantId, member.user.name ?? member.user.email)}
					size="sm"
					variant="ghost"
				>
					Remove
				</Button>
			</div>
		{/each}
	</div>
{/if}

<H3 class="mt-6">You're sharing with</H3>
{#if grants === undefined}
	<Skeleton class="h-24 w-full" />
{:else if grants.length === 0}
	<p class="text-sm text-muted-foreground">You haven't shared your training with anyone.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each grants as grant (grant.id)}
			<Card.Root>
				<Card.Content class="flex flex-wrap items-center gap-2 p-3">
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm">{grant.viewer?.name ?? grant.viewerEmail}</p>
						{#if grant.viewer?.name}<p class="truncate text-xs text-muted-foreground">{grant.viewerEmail}</p>{/if}
					</div>
					<Badge variant="outline">{grant.scope === 'Sessions' ? 'Summary + sessions' : 'Summary'}</Badge>
					{#if grant.pending}
						<Badge variant="secondary">Pending first sign-in</Badge>
					{/if}
					<Button
						class="h-8 w-8 text-muted-foreground"
						onclick={() => revoke(grant.id, grant.viewerEmail)}
						size="icon"
						variant="ghost"
					>
						<TrashIcon />
					</Button>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
{/if}

<H3 class="mt-6">Add someone</H3>
<Card.Root>
	<Card.Content class="flex flex-col gap-3 p-4">
		<div class="flex flex-wrap gap-2">
			<Input
				class="min-w-48 flex-1"
				bind:value={inviteEmail}
				onkeydown={(e) => e.key === 'Enter' && invite()}
				placeholder="their@email.com"
				type="email"
			/>
			<Select.Root
				onSelectedChange={(v) => (inviteScope = (v?.value as 'Summary' | 'Sessions') ?? 'Summary')}
				selected={{ value: inviteScope, label: inviteScope === 'Sessions' ? 'Summary + sessions' : 'Summary only' }}
			>
				<Select.Trigger class="w-48"><Select.Value /></Select.Trigger>
				<Select.Content>
					<Select.Item value="Summary">Summary only</Select.Item>
					<Select.Item value="Sessions">Summary + sessions</Select.Item>
				</Select.Content>
			</Select.Root>
			<Button class="gap-2" disabled={inviting || !inviteEmail.trim()} onclick={invite}>
				<UserPlusIcon /> Share
			</Button>
		</div>

		<div class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
			<p class="font-medium text-foreground">Adding a mate takes two steps, not one.</p>
			<p class="mt-1">
				Sharing here only opens the door <em>inside</em> the app. Cloudflare Access sits in front of it and turns
				away any email it doesn't recognise — before this app ever runs. Both are needed:
			</p>
			<ol class="ml-4 mt-2 list-decimal space-y-1">
				<li>Add their email here <em>(this form — done in one click)</em>.</li>
				<li>
					Add the same email to <strong>Cloudflare Zero Trust → Access → Applications → Dead Lifts → Policies</strong>,
					in the Allow rule's <em>Emails</em> list, <em>and</em> to the <code>CF_ACCESS_ALLOWED_EMAILS</code> environment
					variable on Netlify.
				</li>
			</ol>
			<p class="mt-2">
				Skip step 2 and the grant below will sit on <em>Pending first sign-in</em> forever, looking correct and
				doing nothing.
			</p>
		</div>
	</Card.Content>
</Card.Root>
