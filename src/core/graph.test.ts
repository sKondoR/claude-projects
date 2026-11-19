import { describe, expect, it } from 'vitest';
import { toBoardCard } from './board';
import { buildGraph, chainOf } from './graph';
import { parseGroup } from './parse';

const card = (id: string, fields = '', body = '') => `### ${id} · Задача ${id}\n\n**Приоритет:** Средняя · **Риск:** 0${fields}\n\n${body}`;
const cards = (...blocks: string[]) => parseGroup(blocks.join(''), 'issues').map(toBoardCard);
const ids = (levels: { id: string }[][]) => levels.map((col) => col.map((c) => c.id));

describe('buildGraph', () => {
	it('шаги по самой поздней зависимости; закрытые и неизвестные номера не держат; без линий через промежуточную задачу', () => {
		const g = buildGraph(
			cards(card('А1'), card('А2', ' · **Зависит от:** А1'), card('А3', ' · **Зависит от:** А1, А2'), card('А4', ' · **Зависит от:** Х9'), card('А5')),
		);
		expect(ids(g.levels)).toEqual([['А1', 'А4', 'А5'], ['А2'], ['А3']]);
		expect(g.edges).toEqual([
			{ from: 'А1', to: 'А2' },
			{ from: 'А2', to: 'А3' },
		]);
		expect(g.hidden).toBe(0);
	});

	it('без задач с вопросами владельцу и задач после них', () => {
		const g = buildGraph(
			cards(
				card('Б1', ' · **Уточнить у владельца**', '**Вопрос владельцу:** Какой цвет?\n'),
				card('Б2', ' · **Зависит от:** Б1'),
				card('Б3', ' · **Зависит от:** Б2'),
				card('Б4'),
			),
		);
		expect(ids(g.levels)).toEqual([['Б4']]);
		expect(g.edges).toEqual([]);
		expect(g.hidden).toBe(3);
	});

	it('без задач бэклога и задач после них', () => {
		const backlog = parseGroup(card('Ж1'), 'backlog').map(toBoardCard);
		const g = buildGraph([...backlog, ...cards(card('Ж2', ' · **Зависит от:** Ж1'), card('Ж3'))]);
		expect(ids(g.levels)).toEqual([['Ж3']]);
		expect(g.hidden).toBe(2);
	});

	it('первый шаг: сначала задачи, от которых зависят другие, потом приоритет', () => {
		const g = buildGraph(cards(card('В1').replace('Средняя', 'Высокая'), card('В2'), card('В3'), card('В4', ' · **Зависит от:** В3')));
		expect(g.levels[0]!.map((c) => c.id)).toEqual(['В3', 'В1', 'В2']);
	});

	it('шаг дальше — по месту зависимостей в столбце', () => {
		const g = buildGraph(cards(card('Г1'), card('Г2'), card('Г3', ' · **Зависит от:** Г2'), card('Г4', ' · **Зависит от:** Г1')));
		expect(ids(g.levels)).toEqual([
			['Г1', 'Г2'],
			['Г4', 'Г3'],
		]);
	});

	it('цикл зависимостей не зацикливает разбор', () => {
		const g = buildGraph(cards(card('Д1', ' · **Зависит от:** Д2'), card('Д2', ' · **Зависит от:** Д1')));
		expect(g.levels.flat().map((c) => c.id).sort()).toEqual(['Д1', 'Д2']);
	});
});

describe('chainOf', () => {
	it('зависимости и зависимые задачи, без соседних веток', () => {
		const edges = [
			{ from: 'Е1', to: 'Е2' },
			{ from: 'Е2', to: 'Е3' },
			{ from: 'Е1', to: 'Е4' },
			{ from: 'Е5', to: 'Е3' },
		];
		expect([...chainOf(edges, 'Е2')].sort()).toEqual(['Е1', 'Е2', 'Е3']);
	});
});
