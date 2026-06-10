<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let { form } = $props();
	let submitting = $state(false);
</script>

<div class="flex h-full flex-col items-center justify-center gap-6 p-4">
	<h1 class="text-2xl font-bold">MyFit</h1>
	<form
		method="POST"
		class="flex w-full max-w-xs flex-col gap-3"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
	>
		<Input
			type="password"
			name="password"
			placeholder="Password"
			autocomplete="current-password"
			required
		/>
		{#if form?.incorrect}
			<p class="text-sm text-red-500">Wrong password</p>
		{/if}
		<Button type="submit" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>
</div>
