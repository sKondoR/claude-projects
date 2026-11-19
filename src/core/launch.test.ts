import { describe, expect, it } from 'vitest';
import { toBoardCard, type BoardCard } from './board';
import { launchBlock, launchPrompt, launchWarnings, wtArgs } from './launch';
import { parseGroup } from './parse';

const card = (fields: string, extra: Partial<BoardCard> = {}, body = ''): BoardCard => ({
	...toBoardCard(parseGroup(`### Д1 · Кнопка \`wt\`\n\n**Приоритет:** Средняя · **Риск:** 1${fields}\n\n${body}`, 'issues')[0]!),
	...extra,
});

describe('launchBlock', () => {
	it('обычную задачу можно начать', () => {
		expect(launchBlock(card(''))).toBeNull();
	});

	it('вопросы, пометка владельца, этап и ветка не дают начать', () => {
		expect(launchBlock(card('', {}, '**Вопрос владельцу:** Можно?'))).toMatch(/вопрос/);
		expect(launchBlock(card(' · **Уточнить у владельца**'))).toMatch(/вопрос/);
		expect(launchBlock(card(' · **Ждёт этапа:** 2'))).toBe('Задача ждёт этапа 2');
		expect(launchBlock(card('', { branch: 'feat' }))).toBe('Задача есть только в ветке feat');
	});
});

describe('launchWarnings', () => {
	it('открытые зависимости и отметка сессии', () => {
		const c = card('', {
			depStates: [
				{ id: 'Я1', state: 'open' },
				{ id: 'Я2', state: 'closed' },
				{ id: 'Я3', state: 'unknown' },
			],
			status: { id: 'Д1', status: 'work', branch: 'feat', url: null, at: '' },
		});
		expect(launchWarnings(c)).toEqual(['Ещё открыты задачи, от которых она зависит: Я1.', 'Задача уже отмечена «в работе», ветка feat.']);
		expect(launchWarnings(card(''))).toEqual([]);
	});
});

describe('запуск', () => {
	it('сообщение без обратных кавычек', () => {
		expect(launchPrompt(card(''))).toBe('Возьми задачу Д1 · Кнопка wt');
	});

	it('wt не делит текст и не подставляет переменные', () => {
		expect(wtArgs('C:\\p', 'а; "б" 50% %PATH%')).toEqual(['-w', '0', 'nt', '-d', 'C:\\p', 'claude', "а\\; 'б' 50％ ％PATH％"]);
	});
});
