// Учёт времени Claude Code в проекте: транскрипты сессий проекта и его worktree в папке projects настроек Claude.
// Разбор каждого транскрипта хранится в %APPDATA%\Claude Projects\timelog\ до изменения файла. Claude Code удаляет
// транскрипты старше 30 дней (cleanupPeriodDays), а их разбор остаётся в кеше: прошлые дни не пропадают.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { RESOLVED_DIR } from '../core/groups';
import { parseGroup } from '../core/parse';
import { inDirs } from '../core/sessions';
import { dayRows, localDay, TIMELOG_VERSION, transcriptDirOf, transcriptParser, type DayRow, type SessionLog } from '../core/timelog';
import type { Card } from '../core/types';
import { listMd, readText, writeAtomic } from './files';
import { CLAUDE_DIR } from './sessions';

interface Entry {
	stamp: string; // время изменения и размер транскрипта
	v: number; // TIMELOG_VERSION разбора
	own: boolean; // сессия запущена в проекте или его worktree; раз признанная своей — своя и после удаления worktree
	log: SessionLog | null;
}
type Cache = Record<string, Entry>; // путь транскрипта → разбор

const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const cacheFile = (root: string) => path.join(app.getPath('userData'), 'timelog', `${transcriptDirOf(root)}.json`);

// Файл кеша читается один раз за запуск приложения, дальше кеш живёт в памяти.
// В кеше история дней, транскрипты которых уже удалены: нечитаемый файл не перезаписывается пустым кешем, подсчёт останавливается с ошибкой.
const caches = new Map<string, Cache>();
function loadCache(root: string): Cache {
	let cache = caches.get(root);
	if (!cache) {
		const text = readText(cacheFile(root));
		try {
			cache = text === null ? {} : (JSON.parse(text) as Cache);
		} catch (e) {
			throw new Error(`кеш ${cacheFile(root)} не читается (${(e as Error).message}). Приложение его не перезапишет: исправьте или удалите файл`);
		}
		caches.set(root, cache);
	}
	return cache;
}

const ls = (dir: string) => {
	try {
		return fs.readdirSync(dir);
	} catch {
		return []; // нет папки: Claude Code ещё не запускали
	}
};

// Транскрипт читается по строкам: файл бывает больше 80 МБ.
async function parseFile(file: string): Promise<SessionLog | null> {
	const parser = transcriptParser(localDay);
	const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
	for await (const line of lines) parser.line(line);
	return parser.result();
}

// Транскрипты сессий в папках копий проекта и их подпапок. Папка — путь с «-» вместо знаков, поэтому под начало имени
// попадают и чужие папки (_auction и _auction_ci): чья сессия, решает её cwd. Транскрипты субагентов лежат глубже и не нужны:
// главная сессия ждёт субагента, и это время уже в ней.
function transcripts(copies: string[]): string[] {
	const prefixes = copies.map(transcriptDirOf);
	return ls(PROJECTS_DIR)
		.filter((d) => prefixes.some((p) => d.toLowerCase().startsWith(p)))
		.flatMap((d) => ls(path.join(PROJECTS_DIR, d)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(PROJECTS_DIR, d, f)));
}

// Суть задачи по номеру: открытые задачи доски и закрытые в docs/resolved.
function titlesOf(root: string, open: Card[]): Map<string, string> {
	const dir = path.join(root, RESOLVED_DIR);
	const closed = listMd(dir, (f) => f.endsWith('-DONE.md')).flatMap((f) => parseGroup(readText(path.join(dir, f)) ?? '', f));
	return new Map([...closed, ...open].map((c) => [c.id, c.title.replaceAll('`', '')]));
}

async function compute(root: string, copies: string[], open: Card[]): Promise<DayRow[]> {
	const cache = loadCache(root);
	let changed = false;
	for (const file of transcripts(copies)) {
		const st = await fs.promises.stat(file).catch(() => null);
		if (!st) continue;
		const stamp = `${st.mtimeMs}:${st.size}`;
		let entry = cache[file];
		if (entry?.stamp !== stamp || entry.v !== TIMELOG_VERSION) {
			const log = await parseFile(file).catch(() => null);
			cache[file] = entry = { stamp, v: TIMELOG_VERSION, own: entry?.own ?? false, log };
			changed = true;
		}
		// worktree появляется в списке не сразу: сессия, ещё не признанная своей, проверяется при каждом подсчёте.
		if (!entry.own && entry.log && inDirs(copies, entry.log.cwd)) entry.own = changed = true;
	}
	if (changed) writeAtomic(cacheFile(root), JSON.stringify(cache));
	const titles = titlesOf(root, open);
	return dayRows(
		Object.values(cache).flatMap((e) => (e.own && e.log ? [e.log] : [])),
		(id) => titles.get(id),
	);
}

// Повторный запрос, пока идёт подсчёт, ждёт тот же подсчёт: первый разбор больших транскриптов идёт минуты.
const running = new Map<string, Promise<DayRow[]>>();

export function timeLog(root: string, worktrees: string[], open: Card[]): Promise<DayRow[]> {
	let p = running.get(root);
	if (!p) {
		p = compute(root, [root, ...worktrees], open).finally(() => running.delete(root));
		running.set(root, p);
	}
	return p;
}
