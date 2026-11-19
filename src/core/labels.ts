// Значения полей, которые знает доска, и подписи к ним в окне: трудность по возрастанию, приоритет по убыванию и риск — кому смотреть PR задачи.
import type { Card, MarkStatus } from './types';

export const DIFFICULTIES = ['Лёгкая', 'Средняя', 'Сложная'];
export const PRIORITIES = ['Высокая', 'Средняя', 'Низкая'];
export const RISK_LABELS: Record<string, string> = {
	'0': 'Риск 0: хватает ревью ИИ',
	'1': 'Риск 1: человек читает сводку ревью',
	'2': 'Риск 2: человек смотрит изменения сам',
};

// Отметка сессии: класс плашки на карточке и подпись.
export const MARKS: Record<MarkStatus, [cls: string, label: string]> = {
	work: ['work', 'в работе'],
	simplify: ['check', 'simplify'],
	review: ['check', 'code review'],
	pr: ['pr', 'PR'],
};

// Номер и суть задачи без обратных кавычек разметки: для копирования и первого сообщения Claude.
export const taskTitle = (c: Pick<Card, 'id' | 'title'>) => `${c.id} · ${c.title.replaceAll('`', '')}`;

// Задачу не начать без ответа владельца: есть пометка «Уточнить у владельца» или вопросы.
export const waitsAnswer = (c: Card) => !!c.owner || c.questions.length > 0;

// Метка пометки «Уточнить у владельца»: родительный падеж в именительный; незнакомое слово — как есть.
const NOMINATIVE: Record<string, string> = { владельца: 'владелец', заказчика: 'заказчик', юриста: 'юрист' };
export const ownerLabel = (owner: string) => NOMINATIVE[owner] ?? owner;
