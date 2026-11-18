// Перенос задачи между файлами групп и закрытие в docs/resolved. Функции получают и возвращают тексты файлов;
// запись на диск — забота вызывающего.
import { CARD_RE, codeLines, HEADING_RE, isFieldLine, SECTION_END_RE, sectionLine, sectionOf } from './parse';
import { eolOf, lf, trimBlankEnd, withEol } from './text';

const DONE_TITLE = '# Закрытые задачи';

interface Cut {
	rest: string; // текст без блока задачи
	block: string[]; // строки блока без пустых строк в конце
	section: string | null;
}

// Первая строка с from, которая вне блока кода и подходит под stop; нет такой — длина списка.
function nextLine(lines: string[], code: boolean[], from: number, stop: (line: string) => boolean): number {
	let i = from;
	while (i < lines.length && (code[i] || !stop(lines[i]!))) i++;
	return i;
}

function cutBlock(text: string, id: string): Cut | null {
	const lines = lf(text).split('\n');
	const code = codeLines(lines);
	let section: string | null = null;
	let start = -1;
	for (let i = 0; i < lines.length && start < 0; i++) {
		if (code[i]) continue;
		section = sectionOf(lines[i]!) ?? section;
		if (CARD_RE.exec(lines[i]!)?.[1] === id) start = i;
	}
	if (start < 0) return null;
	const end = nextLine(lines, code, start + 1, (l) => HEADING_RE.test(l));
	const block = trimBlankEnd(lines.slice(start, end));
	const before = trimBlankEnd(lines.slice(0, start));
	const after = lines.slice(end);
	const rest = after.length ? [...before, '', ...after] : [...before, ''];
	return { rest: rest.join('\n'), block, section };
}

// Строки файла без пустых строк в конце.
const linesOf = (text: string) => trimBlankEnd(lf(text).split('\n'));

// Блок перед строкой at, с пустой строкой до и после него.
function insertAt(lines: string[], at: number, block: string[]): string {
	const before = trimBlankEnd(lines.slice(0, at));
	const after = lines.slice(at);
	return [...before, ...(before.length ? [''] : []), ...block, ...(after.length ? ['', ...after] : []), ''].join('\n');
}

// Блок в конец раздела «## section»; раздела нет — новый раздел в конце файла.
// Задача без раздела встаёт перед первым разделом, а не в чужой раздел в конце файла.
function insertBlock(text: string, block: string[], section: string | null): string {
	const lines = linesOf(text);
	const code = codeLines(lines);
	if (section === null) return insertAt(lines, nextLine(lines, code, 0, (l) => sectionOf(l) !== null), block);
	const at = nextLine(lines, code, 0, (l) => sectionOf(l) === section);
	if (at === lines.length) return insertAt(lines, lines.length, [sectionLine(section), '', ...block]);
	return insertAt(lines, nextLine(lines, code, at + 1, (l) => SECTION_END_RE.test(l)), block);
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
	const lines = linesOf(dst.trim() ? dst : DONE_TITLE);
	return { src: withEol(cut.rest, eolOf(src)), dst: withEol(insertAt(lines, lines.length, block), eolOf(dst || null)) };
}
