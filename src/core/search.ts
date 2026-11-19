// Поиск на вкладке: номер, заголовок, раздел, текст и вопросы задачи, без учёта регистра.
import type { Card } from './types';

export function matchesQuery(c: Card, query: string): boolean {
	const q = query.trim().toLocaleLowerCase('ru');
	if (!q) return true;
	return [c.id, c.title, c.section ?? '', c.body, c.questionsText].some((s) => s.toLocaleLowerCase('ru').includes(q));
}
