import type { Card } from './types';
import { lf } from './text';

export const CARD_RE = /^### (\S+) · (.+)$/;
export const HEADING_RE = /^#{1,3} /;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

// Строки блоков кода ``` и ~~~ вместе с ограждением: «# …» в них — не заголовок.
// Незакрытый блок не считается кодом, иначе он поглотил бы все задачи ниже.
export function codeLines(lines: string[]): boolean[] {
	const code = lines.map(() => false);
	let fence = '';
	let open = -1;
	lines.forEach((line, i) => {
		const m = FENCE_RE.exec(line)?.[1];
		if (!fence) {
			if (m) [fence, open] = [m, i];
		} else if (m && m[0] === fence[0] && m.length >= fence.length && !line.trim().slice(m.length).trim()) {
			code.fill(true, open, i + 1);
			fence = '';
		}
	});
	return code;
}

// Поля строки под заголовком задачи: «**Ключ:** значение» или флаг «**Ключ**».
const FIELDS: Record<string, 'priority' | 'difficulty' | 'risk' | 'deps' | 'stage' | 'found'> = {
	Приоритет: 'priority',
	Трудность: 'difficulty',
	Риск: 'risk',
	'Зависит от': 'deps',
	'Ждёт этапа': 'stage',
	Найдено: 'found',
};
const FIELD_LINE = '**Приоритет:**';
const OWNER = /^Уточнить у (.+)$/;
const QUESTION = /^\*\*Вопрос (\S+?):\*\* (.*)$/;
const RECOMMENDED = ' (рекомендуем)';

// Значения полей, которые знает доска: трудность по возрастанию и риск — кому смотреть PR задачи.
export const DIFFICULTIES = ['Лёгкая', 'Средняя', 'Сложная'];
export const RISK_LABELS: Record<string, string> = {
	'0': 'Риск 0: хватает ревью ИИ',
	'1': 'Риск 1: человек читает сводку ревью',
	'2': 'Риск 2: человек смотрит изменения сам',
};

// Метка пометки «Уточнить у владельца»: родительный падеж в именительный; незнакомое слово — как есть.
const NOMINATIVE: Record<string, string> = { владельца: 'владелец', заказчика: 'заказчик', юриста: 'юрист' };
export const ownerLabel = (owner: string) => NOMINATIVE[owner] ?? owner;

export const isFieldLine = (line: string) => line.startsWith(FIELD_LINE);

function parseCard(id: string, title: string, section: string | null, group: string, lines: string[]): Card {
	const card: Card = { id, title, section, group, deps: [], owner: null, questions: [], questionsText: '', body: '', warnings: [] };
	const rows = lines.join('\n').trim().split('\n');
	if (rows[0] && isFieldLine(rows[0])) {
		for (const field of rows.shift()!.split(' · ')) {
			const [, key = '', value] = /^\*\*(.+?)(?::\*\* (.*)|\*\*)$/.exec(field) ?? [];
			const name = FIELDS[key];
			const owner = OWNER.exec(key);
			if (name === 'deps') card.deps = (value ?? '').split(/,\s*/).filter(Boolean);
			else if (name) card[name] = value;
			else if (owner && value === undefined) card.owner = owner[1]!;
		}
	} else card.warnings.push('нет строки полей под заголовком');
	if (card.risk === undefined) card.warnings.push('нет поля «Риск»');
	else if (!Object.hasOwn(RISK_LABELS, card.risk)) card.warnings.push(`неизвестный риск «${card.risk}»: должно быть 0, 1 или 2`);

	// Вопросы и пункты вариантов под ними уходят из подробностей в card.questions.
	const body: string[] = [];
	const copy: string[] = [];
	let question: Card['questions'][number] | null = null;
	for (const row of rows) {
		const q = QUESTION.exec(row);
		if (q) {
			question = { to: q[1]!, text: q[2]!, options: [] };
			card.questions.push(question);
			copy.push((copy.length ? '\n' : '') + q[2]);
		} else if (question && row.startsWith('- ')) {
			const recommended = row.endsWith(RECOMMENDED);
			question.options.push({ text: row.slice(2, recommended ? -RECOMMENDED.length : undefined), recommended });
			copy.push(row);
		} else if (!question || row.trim()) {
			question = null;
			body.push(row);
		}
	}
	card.questionsText = copy.join('\n');
	card.body = body.join('\n').trim();
	return card;
}

// Задачи файла группы по порядку. Текст раздела до первой задачи — пояснение, его нет на доске.
export function parseGroup(text: string, group: string): Card[] {
	const cards: Card[] = [];
	let section: string | null = null;
	let head: RegExpExecArray | null = null;
	let lines: string[] = [];
	const flush = () => {
		if (head) cards.push(parseCard(head[1]!, head[2]!, section, group, lines));
		head = null;
		lines = [];
	};
	const all = lf(text).split('\n');
	const code = codeLines(all);
	for (const [i, line] of all.entries()) {
		if (code[i]) {
			if (head) lines.push(line);
			continue;
		}
		const task = CARD_RE.exec(line);
		if (task || HEADING_RE.test(line)) flush();
		if (task) head = task;
		else if (line.startsWith('## ')) section = line.slice(3);
		else if (head) lines.push(line);
	}
	flush();
	return cards;
}

// Номера задач в тексте — для закрытых задач и проверки номера.
export const idsOf = (text: string) => [...lf(text).matchAll(/^### (\S+) · /gm)].map((m) => m[1]!);
