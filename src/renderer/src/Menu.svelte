<script lang="ts">
	// Меню приложения в правом верхнем углу. popover сам закрывается по клику снаружи и Escape
	// и лежит поверх окна: полоса вкладок с прокруткой его не обрезает.
	import { MediaQuery } from 'svelte/reactivity';

	// Тема сейчас: основной процесс задаёт nativeTheme.themeSource, за ним следует prefers-color-scheme.
	const dark = new MediaQuery('(prefers-color-scheme: dark)');
</script>

<button class="menu-btn" popovertarget="app-menu" title="Меню" aria-label="Меню">
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
</button>
<div id="app-menu" class="menu" popover>
	<div class="menu-row">
		<span>Тема</span>
		<div class="seg" role="group" aria-label="Тема">
			{#each [false, true] as d (d)}
				<button aria-pressed={d === dark.current} onclick={() => window.api.setTheme(d)}>{d ? 'Тёмная' : 'Светлая'}</button>
			{/each}
		</div>
	</div>
</div>
