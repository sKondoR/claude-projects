<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { BoardCard, BoardGroup } from '../../core/board';
	import { ISSUES_DIR } from '../../core/groups';
	import { DIFFICULTIES, RISK_LABELS } from '../../core/labels';
	import type { AppState } from '../../shared/api';
	import Card from './Card.svelte';
	import Steps from './Steps.svelte';

	const api = window.api;

	let app = $state<AppState>({ projects: [], active: null, rulesDir: '' });
	const project = $derived(app.projects.find((p) => p.path === app.active) ?? app.projects[0]);

	// Фильтры и свёрнутые колонки помнятся в окне; без хранилища — значения по умолчанию.
	const saved = <T,>(key: string, fallback: T): T => {
		try {
			return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
		} catch {
			return fallback;
		}
	};
	const save = (key: string, value: unknown) => {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// Без хранилища фильтры живут до перезапуска.
		}
	};
	let difficulty = $state(saved('issues-diff', ''));
	let ownerOnly = $state(saved('issues-owner', false));
	let stage = $state(saved('issues-stage', ''));
	let folds = $state<Record<string, Record<string, boolean>>>(saved('issues-fold', {}));
	const opened = new SvelteSet<string>();
	let errors = $state<string[]>([]);
	let showOverlaps = $state(false);
	let dragged = $state<string | null>(null);
	let over = $state<string | null>(null);
	let flash = $state<string | null>(null);

	onMount(() => {
		void api.state().then((s) => (app = s));
		return api.onState((s) => (app = s));
	});

	// Свёрнута ли колонка: выбор пользователя, а без него — группы без задач.
	const isFolded = (g: BoardGroup) => folds[project?.path ?? '']?.[g.key] ?? !g.cards.length;
	function setFold(key: string, value: boolean) {
		const p = project?.path ?? '';
		folds[p] = { ...folds[p], [key]: value };
		save('issues-fold', folds);
	}

	const cards = $derived(project?.groups.flatMap((g) => g.cards) ?? []);
	const stages = $derived([...new Set(cards.map((c) => c.stage).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })));
	// Этапа из фильтра нет в этом проекте — фильтр не действует; в проекте с этим этапом он снова работает.
	const activeStage = $derived(stages.includes(stage) ? stage : '');
	const shown = (c: BoardCard) => (!difficulty || c.difficulty === difficulty) && (!ownerOnly || !!c.owner) && (!activeStage || c.stage === activeStage);

	async function act(run: Promise<string | null>) {
		const error = await run;
		if (error) errors = [...errors, error];
	}
	const move = (id: string, to: string) => project && act(api.move(project.path, id, to));
	function done(c: BoardCard) {
		if (project && confirm(`Закрыть задачу?\n\n${c.id} · ${c.title}\n\nОна уйдёт в docs/resolved с пометкой «Сделано».`)) void act(api.close(project.path, c.id));
	}
	function removeProject(path: string, name: string) {
		if (confirm(`Убрать проект «${name}» из приложения?\n\nФайлы проекта останутся как есть.`)) void api.removeProject(path);
	}
	function goToDep(id: string) {
		const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
		flash = id;
		setTimeout(() => (flash = null), 1200);
	}

	// Ссылки в задачах относительные от docs/issues: файл открывает программа Windows, адрес — браузер.
	function onLinkClick(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		if (!a || !project) return;
		e.preventDefault();
		void api.open(project.path, a.getAttribute('href') ?? '', a.dataset.from ?? ISSUES_DIR);
	}

	const plural = (n: number, one: string, few: string, many: string) =>
		n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
</script>

<svelte:document onclick={onLinkClick} />

<nav class="tabs">
	{#each app.projects as p (p.path)}
		<div class="tab" class:active={p.path === project?.path} title={p.path}>
			<button class="name" onclick={() => api.setActive(p.path)}>{p.name}</button>
			{#if p.overlaps.length}
				<button
					class="warn"
					title="Общие правила пересекаются с текстом проекта: {p.overlaps.length}"
					onclick={() => {
						void api.setActive(p.path);
						showOverlaps = true;
					}}>⚠ {p.overlaps.length}</button
				>
			{/if}
			<button class="x" title="Убрать проект из приложения" aria-label="Убрать проект" onclick={() => removeProject(p.path, p.name)}>×</button>
		</div>
	{/each}
	<button class="add" title="Добавить проект" aria-label="Добавить проект" onclick={() => api.addProject()}>+</button>
	<button class="rules-dir" title="Папка эталона правил: {app.rulesDir}. Нажмите, чтобы выбрать другую" onclick={() => api.chooseRulesDir()}
		>Правила: {app.rulesDir}</button
	>
</nav>

{#if !project}
	<div class="start">
		<p>Нет проектов. Добавьте папку проекта: приложение создаст в ней файлы задач и правила для Claude.</p>
		<button onclick={() => api.addProject()}>Добавить проект</button>
	</div>
{:else}
	<header>
		<h1>{project.name}</h1>
		<p class="summary">{cards.filter(shown).length} из {cards.length} задач</p>
		<div class="filters">
			<div class="seg" role="group" aria-label="Этап">
				{#each ['', ...stages] as s (s)}
					<button aria-pressed={s === activeStage} onclick={() => save('issues-stage', (stage = s))}>{s ? `Этап ${s}` : 'Все'}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="Владелец">
				{#each [false, true] as v (v)}
					<button aria-pressed={v === ownerOnly} onclick={() => save('issues-owner', (ownerOnly = v))}>{v ? 'Владелец' : 'Все'}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="Трудность">
				{#each ['', ...DIFFICULTIES] as d, i (d)}
					<button aria-pressed={d === difficulty} onclick={() => save('issues-diff', (difficulty = d))}>{#if d}<Steps level={i} />{/if}{d || 'Все'}</button>
				{/each}
			</div>
		</div>
		<div class="legend">
			<span>Приоритет:</span><span><i class="bar" style="background:var(--hi)"></i>высокий</span><span
				><i class="bar" style="background:var(--mid)"></i>средний</span
			><span><i class="bar" style="background:var(--line)"></i>низкий</span>
			<i class="sep"></i><span>Трудность:</span>
			{#each DIFFICULTIES as d, i (d)}<span><Steps level={i + 1} />{d.toLowerCase()}</span>{/each}
			<i class="sep"></i><span>Риск:</span>
			{#each Object.keys(RISK_LABELS) as r (r)}<span class="chip risk r{r}">{r}</span>{/each}
			<i class="sep"></i><span><span class="chip stage">этап N</span>ждёт этапа N</span>
			<i class="sep"></i><span>Перетащите карточку в другую группу, чтобы перенести задачу</span>
		</div>
	</header>

	{#if project.notices.length || errors.length}
		<div class="notices" role="alert">
			{#if errors.length}<button title="Скрыть" onclick={() => (errors = [])}>×</button>{/if}
			{#each [...project.notices, ...errors] as n, i (i)}<p>{n}</p>{/each}
		</div>
	{/if}

	{#if showOverlaps && project.overlaps.length}
		<section class="overlaps">
			<h2>
				Пересечения общих правил с текстом проекта <span
					>{project.overlaps.length}
					{plural(project.overlaps.length, 'пара', 'пары', 'пар')}: проверьте вручную и уберите повтор из текста проекта</span
				>
				<button title="Свернуть" onclick={() => (showOverlaps = false)}>×</button>
			</h2>
			{#each project.overlaps as o (o.key)}
				<div class="pair">
					<p><b>Общее правило</b>{o.rule}</p>
					<p><b><a href={o.file} data-from=".">{o.file}</a>, строка {o.line}</b>{o.text}</p>
					<button onclick={() => api.reviewed(project.path, o.key)}>Проверено</button>
				</div>
			{/each}
		</section>
	{/if}

	<main class="board" style:grid-template-columns={project.groups.map((g) => (isFolded(g) ? '44px' : 'minmax(240px, 1fr)')).join(' ')}>
		{#each project.groups as g (g.key)}
			{@const list = g.cards.filter(shown)}
			<section
				class="col"
				class:folded={isFolded(g)}
				class:over={over === g.key}
				aria-label={g.title}
				ondragover={(e) => {
					if (!dragged) return;
					e.preventDefault();
					over = g.key;
				}}
				ondragleave={() => over === g.key && (over = null)}
				ondrop={(e) => {
					e.preventDefault();
					if (dragged) void move(dragged, g.key);
					dragged = over = null;
				}}
			>
				{#if isFolded(g)}
					<h2>
						<button class="fold" title="Развернуть «{g.title}»" onclick={() => setFold(g.key, false)}>›</button>{g.title}
						<span class="n">{list.length}</span>
					</h2>
				{:else}
					<h2>
						{g.title} <span class="n">{list.length}</span><a href={g.file}>{g.file}</a><button class="fold" title="Свернуть" onclick={() => setFold(g.key, true)}
							>‹</button
						>
					</h2>
					{#each list as c (c.id)}
						<Card
							card={c}
							flash={flash === c.id}
							dragging={dragged === c.id}
							groups={project.groups}
							open={opened.has(c.id)}
							onToggle={() => (opened.has(c.id) ? opened.delete(c.id) : opened.add(c.id))}
							onMove={(to) => move(c.id, to)}
							onDone={() => done(c)}
							onDep={goToDep}
							onDragStart={() => (dragged = c.id)}
							onDragEnd={() => (dragged = over = null)}
						/>
					{:else}
						<p class="empty">Нет задач</p>
					{/each}
				{/if}
			</section>
		{/each}
	</main>
{/if}

