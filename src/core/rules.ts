// Управляемые блоки: текст между <!-- имя:start хеш --> и <!-- имя:end --> пишет приложение, остальное не трогает.
import { eolOf, hash, lf, trimBlankEnd, withEol } from './text';

export const RULES_SOURCE = 'issues-rules.md'; // общие правила в папке эталона
export const CLAUDE_FILE = 'CLAUDE.md';
export const ISSUES_FILE = 'CLAUDE-ISSUES.md';
export const LOCAL_FILE = 'CLAUDE-ISSUES-LOCAL.md'; // правила проекта: приложение создаёт файл один раз
export const RULES_BLOCK = 'issues-rules';
export const POINTER_BLOCK = 'issues-pointer';

const startRe = (name: string) => new RegExp(`^<!-- ${name}:start(?: (\\S+))? -->$`);
const endLine = (name: string) => `<!-- ${name}:end -->`;

// Номера первой и последней строки блока (маркеров) или null.
export function blockRange(text: string, name: string): [number, number] | null {
	const lines = lf(text).split('\n');
	const re = startRe(name);
	const start = lines.findIndex((l) => re.test(l));
	if (start < 0) return null;
	const end = lines.indexOf(endLine(name), start);
	if (end < 0) throw new Error(`Нет маркера ${endLine(name)} после начала блока`);
	return [start, end];
}

export function upsertBlock(text: string | null, name: string, content: string, place: 'top' | 'bottom'): string {
	const body = lf(content).trim();
	const block = [`<!-- ${name}:start ${hash(body)} -->`, ...body.split('\n'), endLine(name)];
	if (!text?.trim()) return [...block, ''].join('\n');
	const eol = eolOf(text);
	const lines = lf(text).split('\n');
	const range = blockRange(text, name);
	let out: string[];
	if (range) {
		// Хеш в маркере — отпечаток того, что записало приложение. Не совпал — блок правили руками: правка не затирается.
		const old = lines.slice(range[0] + 1, range[1]).join('\n').trim();
		const stamp = startRe(name).exec(lines[range[0]]!)?.[1];
		if (old !== body && stamp && stamp !== hash(old))
			throw new Error(`Блок ${name} изменён вручную. Перенесите правку за пределы блока или в эталон, затем удалите блок вместе с маркерами: приложение вставит его заново`);
		out = [...lines.slice(0, range[0]), ...block, ...lines.slice(range[1] + 1)];
	}
	else if (place === 'top') out = [...block, '', ...lines];
	else out = [...trimBlankEnd(lines), '', ...block, ''];
	return withEol(out.join('\n'), eol);
}

// CLAUDE-ISSUES.md: блок общих правил наверху. Правила проекта — в CLAUDE-ISSUES-LOCAL.md;
// прежний текст файла (раздел «Правила проекта» до LOCAL) остаётся под блоком как есть.
export const issuesFileText = (existing: string | null, rules: string) => upsertBlock(existing, RULES_BLOCK, rules, 'top');

// CLAUDE.md: ссылка на CLAUDE-ISSUES.md в конце файла.
export const claudeMdText = (existing: string | null, pointer: string) => upsertBlock(existing, POINTER_BLOCK, pointer, 'bottom');
