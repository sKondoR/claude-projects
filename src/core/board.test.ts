import { describe, expect, it } from 'vitest';
import { buildBoard } from './board';
import { idsOf } from './parse';
import { doneFileOf, orderGroups } from './groups';

const card = (id: string, extra = '') => `### ${id} · Задача ${id}\n\n**Приоритет:** Средняя · **Риск:** 0${extra}\n\n`;

describe('группы', () => {
	it('базовый порядок, прочие по алфавиту, бэклог последним', () => {
		const files = ['legal.md', 'backlog.md', 'issues-e2e.md', 'other-issues.md', 'issues.md', 'security-issues.md'];
		expect(orderGroups(files)).toEqual(['issues.md', 'security-issues.md', 'other-issues.md', 'issues-e2e.md', 'legal.md', 'backlog.md']);
	});

	it('файл закрытых задач группы', () => {
		expect(doneFileOf('backlog.md')).toBe('issues-DONE.md');
		expect(doneFileOf('security-issues.md')).toBe('security-issues-DONE.md');
	});
});

describe('buildBoard', () => {
	const board = buildBoard({
		groups: [
			{ file: 'backlog.md', text: '# Бэклог\n\n' + card('С5', ' · **Зависит от:** С1, С2, Х9') },
			{ file: 'issues.md', text: '# Задачи\n\n' + card('С1') + card('С3') },
		],
		closed: new Set(idsOf(card('С2') + card('С3'))),
		marks: [
			{ id: 'С1', status: 'work', branch: 'a', url: null, at: '2026-11-01T00:00:00Z' },
			{ id: 'С1', status: 'pr', branch: 'a', url: 'https://github.com/x/y/pull/1', at: '2026-11-02T00:00:00Z' },
		],
		worktrees: [
			{
				branch: 'feat/x',
				groups: [{ file: 'issues.md', text: card('С1') + card('С7') }],
				closed: new Set(['С3']),
			},
			{ branch: 'feat/y', groups: [{ file: 'issues.md', text: card('С7') }], closed: new Set(['С1']) },
		],
	});
	const [issues, backlog] = board.groups;
	const byId = (id: string) => board.groups.flatMap((g) => g.cards).find((c) => c.id === id);

	it('столбцы по порядку, заголовок из первой строки', () => {
		expect(board.groups.map((g) => [g.key, g.title])).toEqual([
			['issues', 'Задачи'],
			['backlog', 'Бэклог'],
		]);
		expect(issues?.cards.map((c) => c.id)).toEqual(['С1', 'С3', 'С7']);
		expect(backlog?.cards.map((c) => c.id)).toEqual(['С5']);
	});

	it('состояние зависимостей', () => {
		expect(byId('С5')?.depStates).toEqual([
			{ id: 'С1', state: 'open' },
			{ id: 'С2', state: 'closed' },
			{ id: 'Х9', state: 'unknown' },
		]);
	});

	it('последняя отметка сессии', () => {
		expect(byId('С1')?.status?.status).toBe('pr');
	});

	it('новая задача из worktree с веткой, закрытие в worktree — пометкой', () => {
		expect(byId('С7')?.branch).toBe('feat/x');
		expect(byId('С1')?.branch).toBeNull();
		expect(byId('С1')?.closedIn).toBe('feat/y');
	});

	it('открытая и закрытая одновременно — предупреждение', () => {
		expect(byId('С3')?.warnings).toEqual(['номер уже есть среди закрытых задач']);
	});
});
