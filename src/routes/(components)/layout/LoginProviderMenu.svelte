<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import LoginIcon from 'virtual:icons/mdi/login';
	import { goto } from '$app/navigation';
</script>

<DropdownMenu.Content align="start">
	<DropdownMenu.Group>
		<DropdownMenu.Item class="gap-2" onclick={() => goto('/login')}>
			<LoginIcon class="h-6 w-6 lg:h-7 lg:w-7" />
			<span class="flex-1">Sign in</span>
		</DropdownMenu.Item>
	</DropdownMenu.Group>
</DropdownMenu.Content>
