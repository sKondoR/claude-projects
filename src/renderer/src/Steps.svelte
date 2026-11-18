<script lang="ts">
	// Трудность — ступени: level от 1 (лёгкая) до 3 (сложная), 0 — все серые.
	let { level }: { level: number } = $props();
</script>

<svg class="steps" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
	{#each [0, 1, 2] as i (i)}
		<rect x={i * 6} y={8 - i * 4} width="4" height={4 + i * 4} rx="1" fill={i < level ? 'var(--fg)' : 'var(--faint)'} />
	{/each}
</svg>
