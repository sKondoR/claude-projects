// Отметка задачи на доске Claude Projects из сессии Claude:
//   node docs/issues/issues-status.mjs <номер> work <ветка>   — задача в работе
//   node docs/issues/issues-status.mjs <номер> simplify       — идёт /simplify
//   node docs/issues/issues-status.mjs <номер> review         — идёт code review
//   node docs/issues/issues-status.mjs <номер> pr <адрес PR>  — PR открыт
//   node docs/issues/issues-status.mjs <номер> clear          — снять отметку
// Скрипт пишет status.json рядом с собой, доска замечает изменение файла сама.
// Файл ставит и обновляет приложение Claude Projects из эталона _claude-projects/rules/issues-status.mjs: не правьте его в проекте.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATUS = path.join(DIR, 'status.json');
export const ACTIONS = ['work', 'simplify', 'review', 'pr', 'clear'];

// Номера открытых задач: заголовки «### <номер> · …» в файлах групп рядом со скриптом.
function openIds() {
	const ids = new Set();
	for (const f of fs.readdirSync(DIR)) {
		if (!f.endsWith('.md') || f === 'CLAUDE.md') continue;
		for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/^### (\S+) · /gm)) ids.add(m[1]);
	}
	return ids;
}

function readMarks() {
	try {
		const list = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

// Пустой список удаляет файл. Запись через временный файл: доска не прочитает половину.
function writeMarks(list) {
	if (!list.length) return fs.rmSync(STATUS, { force: true });
	const tmp = `${STATUS}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
	fs.renameSync(tmp, STATUS);
}

// Ставит отметку; возвращает текст ошибки или null. Ветка и адрес PR переходят из прежней отметки.
export function setStatus(id, action, value) {
	if (!ACTIONS.includes(action)) return `Неизвестное действие «${action}»: ${ACTIONS.join(', ')}`;
	if (!openIds().has(id)) return `Нет открытой задачи ${id} в ${DIR}`;
	if (action === 'pr' && !value?.startsWith('https://github.com/')) return 'Адрес PR должен начинаться с https://github.com/';
	const marks = readMarks();
	const prev = marks.find((m) => m.id === id);
	const rest = marks.filter((m) => m.id !== id);
	if (action !== 'clear') {
		rest.push({
			id,
			status: action,
			branch: (action === 'work' ? value : null) ?? prev?.branch ?? null,
			url: (action === 'pr' ? value : null) ?? prev?.url ?? null,
			at: new Date().toISOString(),
		});
	}
	writeMarks(rest);
	return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const [id, action, value] = process.argv.slice(2);
	const error = id ? setStatus(id, action, value) : 'Использование: node docs/issues/issues-status.mjs <номер> work <ветка> | simplify | review | pr <адрес PR> | clear';
	if (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
