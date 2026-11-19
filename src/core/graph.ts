// Граф задач: столбцы-шаги слева направо. В первом шаге задачи без открытых зависимостей, в шаге N — задачи,
// чья самая поздняя зависимость стоит в шаге N−1. Задачи с вопросами владельцу, задачи бэклога и задачи после них в граф не входят.
import type { BoardCard } from './board';
import { isBacklog } from './groups';
import { PRIORITIES, waitsAnswer } from './labels';
import type { Card } from './types';

export interface Edge {
	from: string; // зависимость
	to: string; // задача, которая от неё зависит
}

export interface TaskGraph {
	levels: BoardCard[][];
	edges: Edge[];
	hidden: number; // задачи, которые ждут ответа или отложены в бэклог, сами или через зависимость
}

// Приоритет по убыванию; без приоритета — после «Низкой».
function rank(c: Card) {
	const i = PRIORITIES.indexOf(c.priority ?? '');
	return i < 0 ? PRIORITIES.length : i;
}

// Обход с защитой от цикла: зависимость, которая ведёт назад по циклу, не учитывается.
function acyclic<T>(onCycle: T, compute: (id: string, self: (id: string) => T) => T) {
	const done = new Map<string, T>();
	const visiting = new Set<string>();
	const self = (id: string): T => {
		if (done.has(id)) return done.get(id)!;
		if (visiting.has(id)) return onCycle;
		visiting.add(id);
		const value = compute(id, self);
		visiting.delete(id);
		done.set(id, value);
		return value;
	};
	return self;
}

export function buildGraph(cards: BoardCard[]): TaskGraph {
	const byId = new Map<string, BoardCard>();
	for (const c of cards) if (!byId.has(c.id)) byId.set(c.id, c);
	// Только открытые зависимости: закрытые и неизвестные номера не держат задачу.
	const deps = new Map([...byId].map(([id, c]) => [id, [...new Set(c.deps)].filter((d) => d !== id && byId.has(d))]));
	const depsOf = (id: string) => deps.get(id)!;

	const held = (c: Card) => waitsAnswer(c) || isBacklog(c.group);
	const blocked = acyclic(false, (id, self) => held(byId.get(id)!) || depsOf(id).some(self));
	const visible = [...byId.values()].filter((c) => !blocked(c.id));
	const level = acyclic(-1, (id, self) => Math.max(-1, ...depsOf(id).map(self)) + 1);

	const levels: BoardCard[][] = [];
	for (const c of visible) (levels[level(c.id)] ??= []).push(c);
	// Линию «А → В» не рисуем, если В ждёт А через другую зависимость: она шла бы за карточками промежуточных шагов.
	const ancestors = acyclic(new Set<string>(), (id, self) => new Set(depsOf(id).flatMap((d) => [d, ...self(d)])));
	const edges = visible.flatMap((c) => {
		const own = depsOf(c.id);
		return own.filter((d) => !own.some((o) => o !== d && ancestors(o).has(d))).map((d) => ({ from: d, to: c.id }));
	});

	// Порядок в столбце уменьшает пересечения линий: первый шаг — сначала задачи, от которых зависят другие;
	// следующие — по среднему месту зависимостей в своих столбцах. Дальше приоритет, потом порядок в файлах.
	const hasDependents = new Set(edges.map((e) => e.from));
	const row = new Map<string, number>();
	const order = (c: BoardCard) => {
		if (level(c.id) === 0) return hasDependents.has(c.id) ? 0 : 1;
		const rows = depsOf(c.id).map((d) => row.get(d) ?? 0);
		return rows.reduce((a, b) => a + b, 0) / rows.length;
	};
	for (const col of levels) {
		col.sort((a, b) => order(a) - order(b) || rank(a) - rank(b));
		col.forEach((c, i) => row.set(c.id, i));
	}
	return { levels, edges, hidden: byId.size - visible.length };
}

// Цепочка задачи: все её зависимости и все задачи, которые от неё зависят, прямо или через другие.
export function chainOf(edges: Edge[], id: string): Set<string> {
	const chain = new Set([id]);
	const walk = (side: keyof Edge, other: keyof Edge) => {
		const stack = [id];
		while (stack.length) {
			const cur = stack.pop()!;
			for (const e of edges)
				if (e[side] === cur && !chain.has(e[other])) {
					chain.add(e[other]);
					stack.push(e[other]);
				}
		}
	};
	walk('to', 'from'); // зависимости
	walk('from', 'to'); // задачи, которые ждут эту
	return chain;
}
