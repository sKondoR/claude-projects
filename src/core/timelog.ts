// Учёт времени Claude Code в проекте: транскрипты сессий ~/.claude/projects/<папка>/<сессия>.jsonl → строки по дням.
// Формат транскрипта не описан в документации Claude Code: поля взяты из файлов версии 2.1, незнакомые строки пропускаются.
//
// «Время работы» — промежутки между записями:
// - до ответа Claude или результата инструмента — не дольше 10 мин каждый; результат субагента (инструмент Agent) — целиком: Claude ждал его работу;
// - до записи пользователя — только паузы до 5 мин; более долгое ожидание пользователя не входит.
// Время по часам: время параллельных сессий считается один раз. Время задачи — тоже по часам, по всем её сессиям.
// Задача сессии — номер из отметки `issues-status.mjs <номер> work` или из запроса «Возьми задачу <номер> · …» кнопки «В работу».
// Время до первой такой отметки тоже идёт этой задаче: сессия читала и планировала её. Без отметки время идёт названию сессии.

import { LAUNCH_PREFIX } from './launch';

// Меняй при изменении разбора: кеш пересчитает транскрипты, которые ещё есть на диске.
// Формат DayPart меняй только с переводом старых записей кеша: их транскриптов может уже не быть.
// В записях версии 3 есть поле active — оно не читается.
export const TIMELOG_VERSION = 4;

const WORK_CAP = 10 * 60_000;
const IDLE = 5 * 60_000;
const MARK_RE = /issues-status\.mjs\s+(\S+)\s+work\b/g;
const LAUNCH_RE = new RegExp(`^${LAUNCH_PREFIX}(\\S+) · `);
const ID_RE = /^\p{L}+\d+$/u; // номер задачи: буквы области и число; «<номер>» из примеров в правилах — не номер
const AGENT_TOOLS = new Set(['Agent', 'Task']);

export type Span = [start: number, end: number]; // мс от 1970 года

// Отрезки дня идут по порядку; параллельные сессии объединяет dayRows.
export interface DayPart {
	tasks: Record<string, Span[]>; // номер задачи → отрезки времени работы; '' — без задачи
	prompts: number;
}

export interface SessionLog {
	cwd: string; // папка, в которой запущена сессия
	title: string; // название сессии от Claude; без него — начало первого запроса
	days: Record<string, DayPart>; // день ГГГГ-ММ-ДД → время
}

interface Event {
	t: number;
	human: boolean; // запись пользователя, а не результат инструмента
	prompt: boolean; // запрос с текстом
	full: boolean; // результат субагента: промежуток без ограничения 10 мин
	task: string | null; // отметка задачи в этой записи
}

// Текст запроса пользователя без служебных вставок Claude Code (<command-name>, <system-reminder> и других).
const promptText = (c: unknown) =>
	(typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => String(x.text)).join(' ') : '')
		.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, '')
		.replace(/\s+/g, ' ')
		.trim();

const taskId = (s: string | undefined) => (s && ID_RE.test(s) ? s : null);

// Отрезок вплотную к прошлому продлевает его: в кеше остаются только перерывы.
function addSpan(spans: Span[], start: number, end: number) {
	const last = spans.at(-1);
	if (last?.[1] === start) last[1] = end;
	else spans.push([start, end]);
}

// Разбор транскрипта по строкам: строки подаются по одной, итог — result(). dayOf — день записи по её времени.
export function transcriptParser(dayOf: (t: number) => string) {
	const events: Event[] = [];
	const agentCalls = new Set<string>();
	let cwd = '';
	let title = '';
	let firstPrompt = '';

	function line(raw: string) {
		let o;
		try {
			o = JSON.parse(raw);
		} catch {
			return;
		}
		if (o?.type === 'ai-title' && typeof o.aiTitle === 'string') title = o.aiTitle;
		if (!cwd && typeof o?.cwd === 'string') cwd = o.cwd;
		const t = Date.parse(o?.timestamp);
		if (Number.isNaN(t) || (o.type !== 'user' && o.type !== 'assistant')) return;
		const c = o.message?.content;
		const parts: any[] = Array.isArray(c) ? c : [];
		if (o.type === 'assistant') {
			let task: string | null = null;
			for (const x of parts) {
				if (x?.type !== 'tool_use') continue;
				if (AGENT_TOOLS.has(x.name)) agentCalls.add(x.id);
				if (typeof x.input?.command === 'string') for (const m of x.input.command.matchAll(MARK_RE)) task = taskId(m[1]) ?? task;
			}
			events.push({ t, human: false, prompt: false, full: false, task });
			return;
		}
		const results = parts.filter((x) => x?.type === 'tool_result');
		const human = !o.isMeta && !o.isSidechain && !results.length;
		// Запрос без текста (команда со слешем, прерывание) не считается запросом, но промежуток до него — ожидание пользователя.
		const text = human ? promptText(c) : '';
		const prompt = !!text && !text.startsWith('[Request interrupted');
		if (prompt) firstPrompt ||= text;
		const full = results.some((x) => agentCalls.has(x.tool_use_id));
		events.push({ t, human, prompt, full, task: prompt ? taskId(LAUNCH_RE.exec(text)?.[1]) : null });
	}

	function result(): SessionLog | null {
		if (!events.length) return null;
		events.sort((a, b) => a.t - b.t);
		const days: Record<string, DayPart> = {};
		let cur = events.find((e) => e.task)?.task ?? '';
		events.forEach((e, i) => {
			if (e.task) cur = e.task;
			const d = (days[dayOf(e.t)] ??= { tasks: {}, prompts: 0 });
			if (e.prompt) d.prompts++;
			if (i === 0) return;
			const prev = events[i - 1]!.t;
			const gap = e.t - prev;
			const time = !e.human ? (e.full ? gap : Math.min(gap, WORK_CAP)) : gap <= IDLE ? gap : 0;
			if (time) addSpan((d.tasks[cur] ??= []), prev, prev + time);
		});
		return { cwd, title: title || firstPrompt.slice(0, 100), days };
	}

	return { line, result };
}

export interface DayItem {
	key: string; // номер задачи или название сессии без задачи: строка дня
	id: string; // номер задачи; '' — сессия без задачи
	title: string; // суть задачи или название сессии
	time: number;
}

export interface DayRow {
	day: string;
	time: number;
	sessions: number;
	prompts: number;
	items: DayItem[]; // от большего времени к меньшему
}

// Меньше полуминуты — округляется до 0:00 и только занимает строку.
const MIN_ITEM = 30_000;

// Длина объединения отрезков: время, когда шёл хотя бы один отрезок.
export function unionLength(spans: Span[]): number {
	let total = 0;
	let end = -Infinity;
	for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
		if (e > end) total += e - Math.max(s, end);
		end = Math.max(end, e);
	}
	return total;
}

// Строки по дням, новые сверху. titleOf — суть задачи по номеру; нет задачи в файлах — пусто.
// Время дня и время задачи — по часам: время параллельных сессий считается один раз.
// Если задачи дня шли параллельно, сумма их времени больше времени дня.
export function dayRows(logs: SessionLog[], titleOf: (id: string) => string | undefined): DayRow[] {
	type Item = Omit<DayItem, 'time'> & { spans: Span[] };
	const rows = new Map<string, { day: string; sessions: number; prompts: number; spans: Span[]; items: Map<string, Item> }>();
	for (const log of logs) {
		for (const [day, part] of Object.entries(log.days)) {
			let row = rows.get(day);
			if (!row) rows.set(day, (row = { day, sessions: 0, prompts: 0, spans: [], items: new Map() }));
			row.sessions++;
			row.prompts += part.prompts;
			for (const [id, spans] of Object.entries(part.tasks)) {
				row.spans.push(...spans);
				// Сессии без задачи с одним названием — одна строка: например, продолжение сессии после перезапуска.
				const key = id || `title:${log.title}`;
				let item = row.items.get(key);
				if (!item) row.items.set(key, (item = { key, id, title: id ? (titleOf(id) ?? '') : log.title || 'Без названия', spans: [] }));
				item.spans.push(...spans);
			}
		}
	}
	return [...rows.values()]
		.map(({ spans, items, ...r }) => ({
			...r,
			time: unionLength(spans),
			items: [...items.values()]
				.map(({ spans, ...i }) => ({ ...i, time: unionLength(spans) }))
				.filter((i) => i.time >= MIN_ITEM)
				.sort((a, b) => b.time - a.time),
		}))
		.filter((r) => r.time || r.prompts)
		.sort((a, b) => b.day.localeCompare(a.day));
}

// День ГГГГ-ММ-ДД по местному времени компьютера.
export function localDay(t: number): string {
	const d = new Date(t);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Первый день периода из n дней, последний из которых — день now. Через календарь, а не n×24 ч: сутки перехода на летнее время короче.
export function firstDay(n: number, now = Date.now()): string {
	const d = new Date(now);
	d.setDate(d.getDate() - (n - 1));
	return localDay(d.getTime());
}

// Сумма строк с дня from; пустой from — за всё время.
export const totalFrom = (rows: DayRow[], from = '') => rows.filter((r) => r.day >= from).reduce((s, r) => s + r.time, 0);

export function hm(ms: number): string {
	const m = Math.round(ms / 60_000);
	return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// Папка транскриптов Claude Code для папки проекта: все знаки, кроме латиницы и цифр, — «-». Регистр буквы диска бывает разный.
export const transcriptDirOf = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
