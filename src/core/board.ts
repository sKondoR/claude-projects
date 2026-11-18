// Доска проекта из текстов файлов: столбцы групп, карточки, зависимости, отметки сессий и задачи из worktree.
import { compareGroups, keyOf, titleOf } from './groups';
import { parseGroup } from './parse';
import type { Card, Mark, MdFile } from './types';

export interface BoardCard extends Card {
	depStates: { id: string; state: 'open' | 'closed' | 'unknown' }[];
	status: Mark | null;
	branch: string | null; // задача есть только в worktree этой ветки
	closedIn: string | null; // задачу закрыли в worktree этой ветки
}

export interface BoardGroup {
	key: string;
	file: string;
	title: string;
	cards: BoardCard[];
}

export interface Worktree {
	branch: string;
	groups: MdFile[];
	closed: Set<string>; // номера закрытых задач из docs/resolved
}

export interface BoardInput {
	groups: MdFile[];
	closed: Set<string>;
	marks: Mark[];
	worktrees: Worktree[];
}

const fresh = (c: Card): BoardCard => ({ ...c, depStates: [], status: null, branch: null, closedIn: null });
const column = (g: MdFile): BoardGroup => ({ key: keyOf(g.file), file: g.file, title: titleOf(g.text, g.file), cards: [] });

export function buildBoard({ groups, closed, marks, worktrees }: BoardInput): { groups: BoardGroup[] } {
	const columns = groups.map((g) => ({ ...column(g), cards: parseGroup(g.text, keyOf(g.file)).map(fresh) }));
	const open = new Map<string, BoardCard>();
	for (const c of columns.flatMap((g) => g.cards)) {
		if (open.has(c.id)) c.warnings.push('номер повторяется среди открытых задач');
		if (closed.has(c.id)) c.warnings.push('номер уже есть среди закрытых задач');
		open.set(c.id, c);
	}

	// Worktree: новые задачи веток (первая ветка побеждает) и задачи, закрытые в ветке.
	for (const wt of worktrees) {
		for (const id of wt.closed) {
			const c = open.get(id);
			if (c && !c.branch && !c.closedIn) c.closedIn = wt.branch;
		}
		for (const g of wt.groups) {
			for (const c of parseGroup(g.text, keyOf(g.file))) {
				if (open.has(c.id) || closed.has(c.id)) continue;
				let col = columns.find((x) => x.file === g.file);
				if (!col) columns.push((col = column(g)));
				const card = { ...fresh(c), branch: wt.branch };
				col.cards.push(card);
				open.set(c.id, card);
			}
		}
	}

	const latest = new Map<string, Mark>();
	for (const m of marks) if (!latest.has(m.id) || latest.get(m.id)!.at < m.at) latest.set(m.id, m);
	for (const c of open.values()) {
		c.status = latest.get(c.id) ?? null;
		c.depStates = c.deps.map((id) => ({ id, state: open.has(id) ? 'open' : closed.has(id) ? 'closed' : 'unknown' }));
	}
	return { groups: columns.sort((a, b) => compareGroups(a.file, b.file)) };
}
