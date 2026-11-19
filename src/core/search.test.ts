import { describe, expect, it } from 'vitest';
import { parseGroup } from './parse';
import { matchesQuery } from './search';

const [c] = parseGroup(
	'## Окно доски\n\n### Д2 · Поиск по задачам\n\n**Приоритет:** Средняя · **Риск:** 1 · **Уточнить у владельца**\n\nФильтр карточек.\n\n**Вопрос владельцу:** Искать в ЗАКРЫТЫХ?\n',
	'issues',
);

describe('matchesQuery', () => {
	it('пустой запрос — все задачи', () => {
		expect(matchesQuery(c!, '  ')).toBe(true);
	});

	it('номер, заголовок, раздел, текст и вопросы без учёта регистра', () => {
		for (const q of ['д2', 'ПОИСК', 'окно доски', 'фильтр', 'закрытых']) expect(matchesQuery(c!, q)).toBe(true);
		expect(matchesQuery(c!, 'нет такого')).toBe(false);
	});
});
