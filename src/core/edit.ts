// Перенос задачи между файлами групп и закрытие в docs/resolved. Функции получают и возвращают тексты файлов;
// запись на диск — забота вызывающего.
import { CARD_RE, codeLines, HEADING_RE, isFieldLine } from './parse';
import { eolOf, lf, trimBlankEnd, withEol } from './text';

const DONE_TITLE = '# Закрытые задачи';

interface Cut {
	rest: string; // текст без блока задачи
	block: string[]; // строки блока без пустых строк в конце
	section: string | null;
}

function cutBlock(text: string, id: string): Cut | null {
	const lines = lf(text).split('\n');
	const code = codeLines(lines);
	let section: string | null = null;
	let start = -1;
	for (let i = 0; i < lines.length && start < 0; i++) {
		if (code[i]) continue;
		if (lines[i]!.startsWith('## ')) section = lines[i]!.slice(3);
		if (CARD_RE.exec(lines[i]!)?.[1] === id) start = i;
	}
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length && (code[end] || !HEADING_RE.test(lines[end]!))) end++;
	const block = trimBlankEnd(lines.slice(start, end));
	const before = trimBlankEnd(lines.slice(0, start));
	const after = lines.slice(end);
	const rest = after.length ? [...before, '', ...after] : [...before, ''];
	return { rest: rest.join('\n'), block, section };
}

// Блок в конец раздела «## section»; раздела нет — новый раздел в конце файла.
function insertBlock(text: string, block: string[], section: string | null): string {
	const lines = trimBlankEnd(lf(text).split('\n'));
	const code = codeLines(lines);
	const at = section === null ? -1 : lines.findIndex((l, i) => !code[i] && l === `## ${section}`);
	if (at < 0) {
		const head = section === null ? [] : [`## ${section}`, ''];
		return [...lines, ...(lines.length ? [''] : []), ...head, ...block, ''].join('\n');
	}
	let end = at + 1;
	while (end < lines.length && (code[end] || !/^#{1,2} /.test(lines[end]!))) end++;
	const before = trimBlankEnd(lines.slice(0, end));
	const after = lines.slice(end);
	return [...before, '', ...block, ...(after.length ? ['', ...after] : []), ''].join('\n');
}

export function moveCard(src: string, dst: string, id: string): { src: string; dst: string } | null {
	const cut = cutBlock(src, id);
	if (!cut) return null;
	return { src: withEol(cut.rest, eolOf(src)), dst: withEol(insertBlock(dst, cut.block, cut.section), eolOf(dst)) };
}

const pad = (n: number) => String(n).padStart(2, '0');

// Строка закрытия с доски: дата ДД.ММ.ГГГГ и PR из отметки сессии, если он есть.
export const doneNote = (date: Date, pr?: string | null) =>
	`**Сделано:** ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, отмечено на доске${pr ? `, PR ${pr}` : ''}`;

// Блок уходит в конец файла закрытых задач dst; строка note встаёт сразу под строку полей.
export function closeCard(src: string, dst: string, id: string, note: string): { src: string; dst: string } | null {
	const cut = cutBlock(src, id);
	if (!cut) return null;
	const block = [...cut.block];
	const fields = block.findIndex((l, i) => i > 0 && isFieldLine(l));
	if (fields > 0) block.splice(fields + 1, 0, note);
	else block.splice(1, 0, '', note);
	const base = dst.trim() ? dst : `${DONE_TITLE}\n`;
	return { src: withEol(cut.rest, eolOf(src)), dst: withEol(insertBlock(base, block, null), eolOf(dst || null)) };
}
