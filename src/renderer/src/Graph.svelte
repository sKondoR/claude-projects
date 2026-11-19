<script lang="ts">
	// Граф зависимостей: столбцы-шаги слева направо, линии от зависимости к задаче. Линии считаются по местам
	// карточек в окне и пересчитываются, когда карточка меняет размер: раскрылась, свернулась, сменилась ширина окна.
	import type { Snippet } from 'svelte';
	import type { BoardCard } from '../../core/board';
	import { chainOf, type TaskGraph } from '../../core/graph';

	interface Props {
		graph: TaskGraph;
		shown: (c: BoardCard) => boolean; // фильтры и поиск: остальные карточки бледнее, линии остаются
		item: Snippet<[BoardCard]>;
	}
	let { graph, shown, item }: Props = $props();

	let wrap = $state<HTMLDivElement>();
	let lines = $state<{ from: string; to: string; d: string }[]>([]);
	// Наведённая карточка: её цепочка видна, остальное бледнее.
	let focus = $state<string | null>(null);
	const chain = $derived(focus ? chainOf(graph.edges, focus) : null);

	// Линия выходит справа от зависимости и входит слева в задачу на высоте строки заголовка.
	const HEAD = 20;
	function layout() {
		if (!wrap) return;
		const box = wrap.getBoundingClientRect();
		const at = new Map<string, DOMRect>();
		for (const el of wrap.querySelectorAll<HTMLElement>('.card[data-id]')) at.set(el.dataset.id!, el.getBoundingClientRect());
		lines = graph.edges.flatMap(({ from, to }) => {
			const a = at.get(from);
			const b = at.get(to);
			if (!a || !b) return [];
			const [x1, y1, x2, y2] = [a.right - box.left, a.top - box.top + HEAD, b.left - box.left, b.top - box.top + HEAD];
			const dx = Math.max(24, (x2 - x1) / 2);
			return [{ from, to, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` }];
		});
	}

	// layout читает graph и wrap: эффект перерисует линии при новом графе, наблюдатель — при новом размере карточки.
	$effect(layout);
	const observer = new ResizeObserver(() => layout());
	const observe = (el: Element) => {
		observer.observe(el);
		return () => observer.unobserve(el);
	};
</script>

<main class="graph">
	{#if graph.levels.length}
		<div class="graph-wrap" class:focus={!!chain} bind:this={wrap}>
			<svg class="edges" aria-hidden="true">
				{#each lines as l (l.from + '>' + l.to)}
					<path d={l.d} class:on={chain?.has(l.from) && chain.has(l.to)} />
				{/each}
			</svg>
			{#each graph.levels as col, i (i)}
				<section class="level" aria-label="Шаг {i + 1}">
					<h2 title={i ? `Задачи, которые ждут задач из шага ${i}` : 'Задачи без открытых зависимостей: их можно начать'}>
						Шаг {i + 1} <span class="n">{col.length}</span>
					</h2>
					{#each col as c (c.id)}
						<div
							class="node"
							class:off={!shown(c)}
							class:near={chain?.has(c.id)}
							role="presentation"
							{@attach observe}
							onmouseenter={() => (focus = c.id)}
							onmouseleave={() => focus === c.id && (focus = null)}
						>
							{@render item(c)}
						</div>
					{/each}
				</section>
			{/each}
		</div>
	{:else}
		<p class="empty">Нет задач без вопросов к владельцу</p>
	{/if}
</main>
