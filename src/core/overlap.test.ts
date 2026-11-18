import { describe, expect, it } from 'vitest';
import { findOverlaps } from './overlap';

const RULES = `# Учёт задач

Новую задачу дописывай в конец подходящего раздела или новым разделом в конец файла группы.

- Риск обязателен: ставь его, когда записываешь задачу, и сверяй с диффом перед PR.
- Коротко.
`;

describe('findOverlaps', () => {
	it('находит пересказ правила и номер строки', () => {
		const text = '# Проект\n\nКоманды.\n\nНовую задачу дописывай в конец подходящего раздела или новым разделом в конец файла.\n';
		const [o, ...rest] = findOverlaps(RULES, [{ file: 'CLAUDE.md', text }]);
		expect(rest).toEqual([]);
		expect(o).toMatchObject({ file: 'CLAUDE.md', line: 5 });
		expect(o?.rule).toMatch(/^Новую задачу/);
		expect(o?.score).toBeGreaterThanOrEqual(0.6);
	});

	it('не замечает разные тексты и короткие пункты', () => {
		expect(findOverlaps(RULES, [{ file: 'a', text: 'Сайт работает на Creatium, правки вносит пользователь в редакторе.\n\n- Коротко.\n' }])).toEqual([]);
	});

	it('пропускает строки управляемого блока', () => {
		const text = 'Новую задачу дописывай в конец подходящего раздела или новым разделом в конец файла группы.\n';
		expect(findOverlaps(RULES, [{ file: 'a', text, skip: [0, 0] }])).toEqual([]);
	});

	it('ключ пары меняется вместе с текстом', () => {
		const a = findOverlaps(RULES, [{ file: 'a', text: '- Риск обязателен: ставь его, когда записываешь задачу, и сверяй с диффом перед PR.\n' }]);
		const b = findOverlaps(RULES, [{ file: 'a', text: '- Риск обязателен: ставь его, когда записываешь задачу, и сверяй с диффом перед PR!\n' }]);
		expect(a[0]?.key).toBeTruthy();
		expect(a[0]?.key).not.toBe(b[0]?.key);
	});
});
