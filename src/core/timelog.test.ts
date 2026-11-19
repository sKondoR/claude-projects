import { describe, expect, it } from 'vitest';
import { launchPrompt } from './launch';
import { dayRows, firstDay, hm, totalFrom, transcriptDirOf, transcriptParser, unionLength, type SessionLog, type Span } from './timelog';

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const T0 = Date.parse('2026-11-18T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const span = (from: number, to: number): Span => [T0 + from * 60_000, T0 + to * 60_000];

const user = (min: number, content: unknown, extra = {}) => JSON.stringify({ type: 'user', timestamp: at(min), cwd: 'C:\\p', message: { content }, ...extra });
const assistant = (min: number, parts: unknown[] = [{ type: 'text', text: 'ok' }]) => JSON.stringify({ type: 'assistant', timestamp: at(min), message: { content: parts } });
const bash = (id: string, command: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const result = (min: number, id: string) => user(min, [{ type: 'tool_result', tool_use_id: id, content: 'x' }]);

function parse(lines: string[]) {
	const p = transcriptParser(dayOf);
	lines.forEach(p.line);
	return p.result();
}

describe('transcriptParser', () => {
	it('время работы — промежутки до ответа и результата инструмента; долгое ожидание пользователя не входит', () => {
		const log = parse([user(0, 'сделай'), assistant(2, [bash('a', 'ls')]), result(3, 'a'), assistant(4), user(30, 'ещё'), assistant(31)]);
		expect(log?.days['2026-11-18']).toEqual({ tasks: { '': [span(0, 4), span(30, 31)] }, prompts: 2 });
	});
	it('промежуток работы — не больше 10 мин, а результат субагента — целиком', () => {
		const agent = { type: 'tool_use', id: 'g', name: 'Agent', input: { prompt: 'x' } };
		const log = parse([user(0, 'a'), assistant(1, [bash('a', 'sleep')]), result(31, 'a'), assistant(32, [agent]), result(62, 'g')]);
		expect(log?.days['2026-11-18']?.tasks).toEqual({ '': [span(0, 11), span(31, 62)] });
	});
	it('паузы пользователя до 5 мин входят во время работы, более долгие — нет', () => {
		const log = parse([user(0, 'a'), assistant(1), user(4, 'b'), assistant(5), user(20, 'c')]);
		expect(log?.days['2026-11-18']?.tasks).toEqual({ '': [span(0, 5)] });
	});
	it('задача из отметки work; время до отметки — той же задаче, после следующей отметки — новой', () => {
		const log = parse([
			user(0, 'посмотри задачи'),
			assistant(2, [bash('a', 'node docs/issues/issues-status.mjs С12 work feat/x')]),
			result(3, 'a'),
			assistant(4, [bash('b', 'node docs/issues/issues-status.mjs Р3 work feat/y && git status')]),
			result(5, 'b'),
		]);
		expect(log?.days['2026-11-18']?.tasks).toEqual({ С12: [span(0, 3)], Р3: [span(3, 5)] });
	});
	it('задача из запроса кнопки «В работу»; «<номер>» из примеров правил — не задача', () => {
		const log = parse([user(0, launchPrompt({ id: 'К3', title: 'Форма' })), assistant(1, [bash('a', 'cat x # issues-status.mjs <номер> work <ветка>')]), result(2, 'a')]);
		expect(log?.days['2026-11-18']?.tasks).toEqual({ К3: [span(0, 2)] });
	});
	it('название — последнее ai-title; без него — начало первого запроса без служебных вставок', () => {
		const lines = [user(0, '<command-name>/clear</command-name>'), user(1, [{ type: 'text', text: 'почини  <system-reminder>x</system-reminder>вход' }]), assistant(2)];
		expect(parse(lines)?.title).toBe('почини вход');
		const titled = [...lines, '{"type":"ai-title","aiTitle":"Старое"}', '{"type":"ai-title","aiTitle":"Вход по SMS"}'];
		expect(parse(titled)?.title).toBe('Вход по SMS');
	});
	it('команда со слешем, прерывание и служебные записи — не запросы', () => {
		const log = parse([user(0, '<command-name>/clear</command-name>'), user(1, '[Request interrupted by user]'), user(2, 'x', { isMeta: true }), assistant(3)]);
		expect(log?.days['2026-11-18']?.prompts).toBe(0);
	});
	it('папка сессии — первое поле cwd; битые и незнакомые строки пропускаются', () => {
		expect(parse(['{', '{"type":"mode"}', user(0, 'a'), assistant(1)])?.cwd).toBe('C:\\p');
		expect(parse(['{"type":"mode"}'])).toBeNull();
	});
	it('сессия через полночь — время по дням', () => {
		const p = transcriptParser(dayOf);
		const late = (min: number) => Date.parse('2026-11-18T23:58:00Z') + min * 60_000;
		p.line(JSON.stringify({ type: 'user', timestamp: new Date(late(0)).toISOString(), message: { content: 'a' } }));
		p.line(JSON.stringify({ type: 'assistant', timestamp: new Date(late(1)).toISOString(), message: { content: [] } }));
		p.line(JSON.stringify({ type: 'assistant', timestamp: new Date(late(4)).toISOString(), message: { content: [] } }));
		const days = p.result()?.days ?? {};
		expect([unionLength(days['2026-11-18']?.tasks[''] ?? []), unionLength(days['2026-11-19']?.tasks[''] ?? [])]).toEqual([60_000, 3 * 60_000]);
	});
});

describe('dayRows', () => {
	const log = (title: string, days: SessionLog['days']): SessionLog => ({ cwd: 'C:\\p', title, days });
	const part = (tasks: Record<string, Span[]>) => ({ tasks, prompts: 1 });

	it('задачи с сутью, сессии без задачи — по названию; время задачи по всем её сессиям; новые дни сверху', () => {
		const rows = dayRows(
			[
				log('Сессия А', { '2026-11-18': part({ С1: [span(0, 4)], '': [span(4, 6)] }) }),
				log('Сессия Б', { '2026-11-18': part({ С1: [span(2, 7)] }), '2026-11-19': part({ '': [span(0, 1)] }) }),
			],
			(id) => (id === 'С1' ? 'Форма заявки' : undefined),
		);
		expect(rows.map((r) => r.day)).toEqual(['2026-11-19', '2026-11-18']);
		expect(rows[1]).toMatchObject({ time: 7 * 60_000, sessions: 2, prompts: 2 });
		expect(rows[1]?.items).toEqual([
			{ key: 'С1', id: 'С1', title: 'Форма заявки', time: 7 * 60_000 },
			{ key: 'title:Сессия А', id: '', title: 'Сессия А', time: 2 * 60_000 },
		]);
	});
	it('задача без сути в файлах — пустая суть; доли меньше полуминуты не показываются', () => {
		const rows = dayRows([log('', { '2026-11-18': part({ Х9: [span(0, 2)], '': [[T0, T0 + 20_000]] }) })], () => undefined);
		expect(rows[0]?.items).toEqual([{ key: 'Х9', id: 'Х9', title: '', time: 2 * 60_000 }]);
	});
	it('по часам: параллельные сессии дня считаются один раз; у параллельных задач — своё полное время', () => {
		const a = log('a', { '2026-11-18': part({ С1: [span(0, 10)] }) });
		const b = log('b', { '2026-11-18': part({ С2: [span(5, 15), span(20, 25)] }) });
		const [row] = dayRows([a, b], () => undefined);
		expect(row?.time).toBe(20 * 60_000);
		expect(row?.items.map((i) => [i.id, i.time])).toEqual([
			['С2', 15 * 60_000],
			['С1', 10 * 60_000],
		]);
	});
	it('день без работы и запросов не показывается', () => {
		expect(dayRows([log('a', { '2026-11-18': { tasks: {}, prompts: 0 } })], () => undefined)).toEqual([]);
	});
});

it('firstDay — по календарю; totalFrom — сумма с этого дня, без дня — за всё время', () => {
	const now = new Date(2026, 10, 19, 12).getTime();
	expect([firstDay(1, now), firstDay(7, now), firstDay(30, now)]).toEqual(['2026-11-19', '2026-11-13', '2026-10-21']);
	const row = (day: string, time: number) => ({ day, time, sessions: 1, prompts: 1, items: [] });
	const rows = [row('2026-11-19', 1), row('2026-11-13', 10), row('2026-11-12', 100)];
	expect([totalFrom(rows, '2026-11-13'), totalFrom(rows)]).toEqual([11, 111]);
});

it('unionLength — вложенные, соседние и раздельные отрезки', () => {
	expect(unionLength([span(10, 20), span(0, 5), span(12, 15), span(5, 8)])).toBe(18 * 60_000);
	expect(unionLength([])).toBe(0);
});

it('hm — часы и минуты', () => {
	expect([hm(0), hm(59_000), hm(3_600_000 + 5 * 60_000)]).toEqual(['0:00', '0:01', '1:05']);
});

it('transcriptDirOf — папка транскриптов как у Claude Code, в нижнем регистре', () => {
	expect(transcriptDirOf('C:\\Users\\kondr\\_projects\\_auction')).toBe('c--users-kondr--projects--auction');
});
