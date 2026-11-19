import { RISK_LABELS } from './labels';
import type { Card } from './types';
import { lf } from './text';

export const CARD_RE = /^### (\S+) · (.+)$/;
export const HEADING_RE = /^#{1,3} /; // конец задачи
export const SECTION_END_RE = /^#{1,2} /; // конец раздела «## …»
const SECTION_PREFIX = '## ';
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

// Имя раздела из строки «## имя» или null.
export const sectionOf = (line: string) => (line.startsWith(SECTION_PREFIX) ? line.slice(SECTION_PREFIX.length) : null);
export const sectionLine = (name: string) => SECTION_PREFIX + name;

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
		const name = sectionOf(line);
		if (task || HEADING_RE.test(line)) flush();
		if (task) head = task;
		else if (name !== null) section = name;
		else if (head) lines.push(line);
	}
	flush();
	return cards;
}

// Номера из строк, где совпал один из шаблонов (номер — первая группа). Строки в блоках кода не считаются, как в parseGroup.
function scanIds(text: string, res: RegExp[]): string[] {
	const lines = lf(text).split('\n');
	const code = codeLines(lines);
	return lines.flatMap((line, i) => {
		if (code[i]) return [];
		const task = res.map((re) => re.exec(line)).find(Boolean);
		return task ? [task[1]!] : [];
	});
}

// Номера задач в тексте — для открытых задач и проверки номера.
export const idsOf = (text: string) => scanIds(text, [CARD_RE]);

// Старый формат закрытых задач в docs/resolved: пункт списка «- [x] **У4 · Низкая · …** …».
const OLD_DONE_RE = /^- \[[ xX]\] \*\*(\S+) · /;

// Номера закрытых задач: заголовки задач и пункты старого формата.
export const closedIdsOf = (text: string) => scanIds(text, [CARD_RE, OLD_DONE_RE]);
