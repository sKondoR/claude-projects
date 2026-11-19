<script lang="ts">
	import type { BoardCard, BoardGroup } from '../../core/board';
	import { inline, markdown } from '../../core/markdown';
	import { DIFFICULTIES, MARKS, ownerLabel, RISK_LABELS, taskTitle } from '../../core/labels';
	import { launchBlock } from '../../core/launch';
	import Steps from './Steps.svelte';

	interface Props {
		card: BoardCard;
		groups: BoardGroup[];
		open: boolean;
		flash: boolean; // переход к карточке по зависимости
		dragging: boolean;
		launching: boolean; // запуск уже идёт: второй клик не откроет вторую сессию
		onToggle: () => void;
		onMove: (to: string) => void;
		onDone: () => void;
		onLaunch: () => void;
		onDep: (id: string) => void;
		onDragStart: () => void;
		onDragEnd: () => void;
	}
	let { card, groups, open, flash, dragging, launching, onToggle, onMove, onDone, onLaunch, onDep, onDragStart, onDragEnd }: Props = $props();

	const PRI: Record<string, string> = { Высокая: 'p-hi', Средняя: 'p-mid' };

	let copied = $state(false);
	let askCopied = $state(false);

	const titleText = $derived(taskTitle(card));
	// Неверный или пустой риск — красная плашка, подсказка из предупреждений разбора.
	const riskLabel = $derived(RISK_LABELS[card.risk ?? '']);
	const mark = $derived(card.status && MARKS[card.status.status]);
	// Адрес PR становится ссылкой, только если это https://github.com/…. Плашка не пускает клик к карточке и к общему
	// обработчику ссылок, поэтому ссылка открывается как новое окно: его перехватывает основной процесс и открывает браузер.
	const prUrl = $derived(card.status?.status === 'pr' && card.status.url?.startsWith('https://github.com/') ? card.status.url : null);
	const prNumber = $derived(/\/pull\/(\d+)/.exec(prUrl ?? '')?.[1]);
	const editable = $derived(!card.branch);
	const info = $derived([card.section, card.found && `Найдено: ${card.found}`].filter(Boolean).join(' · '));
	const block = $derived(launchBlock(card));

	function copy(text: string, set: (v: boolean) => void) {
		void window.api.copy(text).then(() => {
			set(true);
			setTimeout(() => set(false), 1200);
		});
	}
</script>

<article
	class="card {PRI[card.priority ?? ''] ?? ''}"
	class:branch={!!card.branch}
	class:dragging
	class:flash
	data-id={card.id}
	draggable={!open && editable}
	title="Приоритет: {card.priority ?? 'не указан'}"
	ondragstart={(e) => {
		e.dataTransfer?.setData('text/plain', card.id);
		onDragStart();
	}}
	ondragend={onDragEnd}
>
	<button class="head" aria-expanded={open} onclick={onToggle}>
		<span class="title"><span class="id">{card.id}</span>{@html inline(card.title)}</span>
		<span class="meta">
			{#if card.difficulty}<span title="Трудность: {card.difficulty}"><Steps level={DIFFICULTIES.indexOf(card.difficulty) + 1} /></span>{/if}
			<span class="chip risk r{riskLabel ? card.risk : 2}" title={riskLabel ?? card.warnings.join('\n')}>риск {card.risk ?? '?'}</span>
			{#if card.stage}<span class="chip stage" title="Ждёт этапа {card.stage}: до него задачу не начать">этап {card.stage}</span>{/if}
			{#each card.depStates as d (d.id)}
				<span
					class="chip dep {d.state}"
					role="link"
					tabindex="-1"
					title="Зависит от {d.id}: {d.state === 'closed' ? 'закрыта' : d.state === 'open' ? 'открыта' : 'нет в задачах'}"
					onclick={(e) => {
						e.stopPropagation();
						onDep(d.id);
					}}
					onkeydown={() => {}}>← {d.id}</span
				>
			{/each}
			{#if card.status && mark}
				<svelte:element
					this={prUrl ? 'a' : 'span'}
					class="chip mark {mark[0]}"
					title={card.status.branch ?? ''}
					href={prUrl}
					target={prUrl ? '_blank' : undefined}
					onclick={(e: MouseEvent) => e.stopPropagation()}
					role={prUrl ? undefined : 'presentation'}><i></i>{mark[1]}{prNumber ? ` #${prNumber}` : ''}</svelte:element
				>
			{/if}
			{#if card.branch}<span class="note" title="Задачи ещё нет в основной рабочей копии">в ветке {card.branch}</span>{/if}
			{#if card.closedIn}<span class="note">закрыта в ветке {card.closedIn}</span>{/if}
			{#if card.warnings.length}<span class="chip bad" title={card.warnings.join('\n')}>⚠ {card.warnings.length}</span>{/if}
			{#if card.owner}<span class="chip owner">{ownerLabel(card.owner)}</span>{/if}
		</span>
	</button>
	<button class="copy-title" class:done={copied} title="Скопировать номер и название" aria-label="Скопировать номер и название" onclick={() => copy(titleText, (v) => (copied = v))}>
		{#if copied}
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
		{:else}
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"
				><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" /></svg
			>
		{/if}
	</button>
	{#if open}
		{#if card.questions.length}
			{@const many = card.questions.length > 1}
			<div class="ask">
				<b>{many ? 'Вопросы' : 'Вопрос'} {card.questions[0]!.to}</b>
				{#each card.questions as q, i (i)}
					<p class="q">{@html inline(q.text)}</p>
					{#if q.options.length}
						<ul>
							{#each q.options as o, j (j)}
								<li class:rec={o.recommended}>{@html inline(o.text)}{#if o.recommended}<span class="tag">рекомендуем</span>{/if}</li>
							{/each}
						</ul>
					{/if}
				{/each}
				<button onclick={() => copy(`${titleText}\n\n${card.questionsText}`, (v) => (askCopied = v))}
					>{askCopied ? 'скопировано' : many ? 'скопировать вопросы' : 'скопировать вопрос'}</button
				>
			</div>
		{/if}
		<div class="details">
			{#if card.warnings.length}<p class="warnings">⚠ {card.warnings.join('; ')}</p>{/if}
			{#if info}<p class="info">{info}</p>{/if}
			{@html markdown(card.body)}
			{#if editable}
				<div class="actions">
					<label
						>Перенести в
						<select value={card.group} onchange={(e) => onMove(e.currentTarget.value)}>
							{#each groups as g (g.key)}<option value={g.key}>{g.title}</option>{/each}
						</select>
					</label>
					<button class="launch-btn" disabled={!!block || launching} title={block ?? 'Открыть вкладку Windows Terminal и запустить Claude по задаче'} onclick={onLaunch}
						>В работу</button
					>
					<button class="done-btn" onclick={onDone}>Сделано</button>
				</div>
			{/if}
		</div>
	{/if}
</article>
