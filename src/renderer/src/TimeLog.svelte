<script lang="ts">
	// Панель учёта времени: выезжает справа на пол-окна под полосой вкладок: вкладки и кнопка часов остаются доступны. Строка — день: время работы и задачи дня.
	import { fade, fly } from 'svelte/transition';
	import { firstDay, hm, totalFrom, type DayRow } from '../../core/timelog';

	let { root, name, top, onClose }: { root: string; name: string; top: number; onClose: () => void } = $props();

	let rows = $state<DayRow[] | null>(null);
	let error = $state('');

	// Смена вкладки при открытой панели — подсчёт для нового проекта; ответ по прежнему проекту отбрасывается.
	$effect(() => {
		const path = root;
		let stale = false;
		rows = null;
		error = '';
		window.api.timeLog(path).then(
			(r) => !stale && (rows = r),
			(e: Error) => !stale && (error = e.message),
		);
		return () => (stale = true);
	});

	// Периоды итогов: последние n дней вместе с сегодняшним; без n — всё время.
	const PERIODS: [string, number | undefined][] = [
		['Сегодня', 1],
		['7 дней', 7],
		['30 дней', 30],
		['Всего', undefined],
	];

	const thisYear = new Date().getFullYear();
	function dateLabel(day: string) {
		const d = new Date(`${day}T00:00`);
		const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear() === thisYear ? '' : `.${d.getFullYear()}`}`;
		return { date, weekday: d.toLocaleDateString('ru-RU', { weekday: 'short' }) };
	}
	const maxTime = $derived(Math.max(1, ...(rows ?? []).map((r) => r.time)));
</script>

<button class="scrim" tabindex="-1" aria-label="Закрыть учёт времени" style:top="{top}px" onclick={onClose} transition:fade={{ duration: 150 }}></button>
<div class="timelog" style:top="{top}px" role="dialog" aria-label="Время Claude Code в проекте {name}" transition:fly={{ x: 480, duration: 220, opacity: 1 }}>
	<header>
		<h2>Время Claude <span>{name}</span></h2>
		<button class="icon-btn close" title="Закрыть (Esc)" aria-label="Закрыть" onclick={onClose}>×</button>
	</header>
	<p class="about">
		По транскриптам Claude Code на этом компьютере, в проекте и его worktree. <b>Время работы</b> — Claude отвечает и работает с инструментами, а ваши паузы до 5 мин тоже входят.
		Время по часам: параллельные сессии считаются один раз. Задача — по отметке «в работе» или кнопке «В работу», иначе название сессии.
	</p>

	{#if error}
		<p class="state err">Не удалось посчитать время: {error}</p>
	{:else if !rows}
		<p class="state">Считаю время по транскриптам… Первый подсчёт большого проекта идёт до минуты, дальше — секунды.</p>
	{:else if !rows.length}
		<p class="state">В этом проекте ещё не было сессий Claude Code.</p>
	{:else}
		<div class="totals">
			{#each PERIODS as [label, n] (label)}
				{@const t = totalFrom(rows, n ? firstDay(n) : '')}
				<div><span>{label}</span><b>{hm(t)}</b></div>
			{/each}
		</div>
		<div class="scroll">
			<table>
				<thead>
					<tr><th>Дата</th><th class="n">Время работы</th><th>Задачи</th></tr>
				</thead>
				<tbody>
					{#each rows as r (r.day)}
						{@const d = dateLabel(r.day)}
						<tr>
							<td class="date" title="Сессий: {r.sessions}, запросов: {r.prompts}">{d.date} <span>{d.weekday}</span></td>
							<td class="n time">{hm(r.time)}<i class="bar" style:width="{(r.time / maxTime) * 100}%"></i></td>
							<td>
								<ul>
									{#each r.items as it (it.key)}
										<li>
											{#if it.id}<b class="id">{it.id}</b>{/if}<span class="title" class:session={!it.id} title={it.title}>{it.title}</span><span class="t">{hm(it.time)}</span>
										</li>
									{/each}
								</ul>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
