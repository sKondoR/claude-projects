// Кнопка «В работу»: вкладка Windows Terminal в папке проекта запускает claude с номером и сутью задачи.
import type { BoardCard } from './board';
import { MARKS, taskTitle } from './labels';
import type { Card } from './types';

// Почему задачу не начать сейчас; null — начать можно.
export function launchBlock(c: BoardCard): string | null {
	if (c.branch) return `Задача есть только в ветке ${c.branch}`;
	if (c.questions.length || c.owner) return 'Сначала нужен ответ на вопросы по задаче';
	if (c.stage) return `Задача ждёт этапа ${c.stage}`;
	return null;
}

// О чём спросить перед запуском: открытые зависимости и отметка другой сессии.
export function launchWarnings(c: BoardCard): string[] {
	const warnings: string[] = [];
	const deps = c.depStates.filter((d) => d.state === 'open').map((d) => d.id);
	if (deps.length) warnings.push(`Ещё открыты задачи, от которых она зависит: ${deps.join(', ')}.`);
	if (c.status) warnings.push(`Задача уже отмечена «${MARKS[c.status.status][1]}»${c.status.branch ? `, ветка ${c.status.branch}` : ''}.`);
	return warnings;
}

// По этому началу запроса учёт времени узнаёт задачу сессии (timelog.ts).
export const LAUNCH_PREFIX = 'Возьми задачу ';
export const launchPrompt = (c: Pick<Card, 'id' | 'title'>) => LAUNCH_PREFIX + taskTitle(c);

// Аргументы wt.exe. Windows Terminal сам разбирает свою командную строку:
// «;» делит её на команды — экранируем; «"» режет текст на аргументы — меняем на «'»;
// %ИМЯ% подставляет переменную среды — меняем «%» на «％».
export function wtArgs(dir: string, prompt: string): string[] {
	const text = prompt.replaceAll('"', "'").replaceAll('%', '％').replaceAll(';', '\\;');
	return ['-w', '0', 'nt', '-d', dir, 'claude', text];
}
