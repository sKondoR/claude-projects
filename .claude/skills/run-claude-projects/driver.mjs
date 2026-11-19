// Драйвер Claude Projects для агента: запускает собранное приложение (out/) через Playwright,
// выполняет команды из аргументов по порядку, печатает результат и закрывает окно.
// Настройки и проекты — временные: установленное приложение, его settings.json и настоящие проекты не трогаются.
//
//   node .claude/skills/run-claude-projects/driver.mjs "ss light" "theme dark" "ss dark"
//
// Команды: ss <имя> [x y w h] · click <селектор> · hover <селектор> · eval <js> · theme light|dark · wait <мс>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const SHOTS = process.env.SHOTS_DIR ?? path.join(os.tmpdir(), 'claude-projects-shots');
const exe = path.join(REPO, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const card = (id, title, fields, body) => `### ${id} · ${title}\n\n${fields}\n\n${body}\n`;

// Проект-пример: задачи с разным приоритетом, трудностью и риском, зависимости и вопрос владельцу для графа; повтор общего правила в CLAUDE.md даёт ⚠ на вкладке.
function seed(root) {
	const demo = path.join(root, 'demo');
	fs.mkdirSync(path.join(demo, 'docs/issues'), { recursive: true });
	fs.mkdirSync(path.join(root, 'demo2'), { recursive: true });
	fs.writeFileSync(
		path.join(demo, 'docs/issues/issues.md'),
		[
			'# Задачи\n\n## Сайт\n',
			card('С1', 'Платёжный аккаунт', '**Приоритет:** Высокая · **Трудность:** Лёгкая · **Риск:** 2 · **Ждёт этапа:** 1', 'Текст задачи.'),
			card('С2', 'Форма заявки', '**Приоритет:** Средняя · **Трудность:** Средняя · **Риск:** 1', 'Текст.'),
			card('С3', 'Метрика', '**Приоритет:** Низкая · **Трудность:** Сложная · **Риск:** 0 · **Зависит от:** С2', 'Текст.'),
			card('С4', 'Отчёт по заявкам', '**Приоритет:** Средняя · **Трудность:** Лёгкая · **Риск:** 0 · **Зависит от:** С2, С3', 'Текст.'),
			card('С5', 'Цвет кнопки', '**Приоритет:** Низкая · **Трудность:** Лёгкая · **Риск:** 0 · **Уточнить у владельца**', '**Вопрос владельцу:** Какой цвет кнопки?'),
			card('С6', 'Кнопка на всех страницах', '**Приоритет:** Низкая · **Трудность:** Лёгкая · **Риск:** 0 · **Зависит от:** С5', 'Текст.'),
		].join('\n'),
	);
	fs.writeFileSync(path.join(demo, 'CLAUDE.md'), '# Проект\n\n- Находки проверок безопасности записывай сразу.\n');
	const settings = { projects: [demo, path.join(root, 'demo2')], active: demo, rulesDir: path.join(REPO, 'rules'), reviewed: {}, autostart: true, theme: 'light' };
	fs.mkdirSync(path.join(root, 'user-data'));
	fs.writeFileSync(path.join(root, 'user-data/settings.json'), JSON.stringify(settings, null, 2));
	return path.join(root, 'user-data');
}

// Транскрипты сессий Claude Code в проекте-примере для панели учёта времени: вчера задача С2 по отметке work, сегодня сессия без задачи.
// Папка настроек Claude своя (CLAUDE_CONFIG_DIR): приложение не читает настоящие сессии и транскрипты.
function seedTranscript(root, demo) {
	// Имя папки — как у Claude Code и transcriptDirOf в src/core/timelog.ts; отметка и запрос — форматы MARK_RE и launchPrompt.
	const dir = path.join(root, 'claude/projects', demo.replace(/[^a-zA-Z0-9]/g, '-'));
	fs.mkdirSync(dir, { recursive: true });
	const day = (offset, h, m) => {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		d.setHours(h, m, 0, 0);
		return d.toISOString();
	};
	const user = (timestamp, content) => ({ type: 'user', timestamp, cwd: demo, message: { content } });
	const assistant = (timestamp, content = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', timestamp, cwd: demo, message: { content } });
	const mark = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node docs/issues/issues-status.mjs С2 work feat/form' } };
	const sessions = {
		s1: [
			user(day(-1, 10, 0), 'Возьми задачу С2 · Форма заявки'),
			assistant(day(-1, 10, 4), [mark]),
			user(day(-1, 10, 5), [{ type: 'tool_result', tool_use_id: 't1', content: '' }]),
			assistant(day(-1, 10, 40)),
		],
		s2: [user(day(0, 9, 0), 'Почему падает сборка?'), assistant(day(0, 9, 4)), user(day(0, 9, 6), 'Почини'), assistant(day(0, 9, 9)), { type: 'ai-title', aiTitle: 'Падение сборки' }],
	};
	for (const [name, lines] of Object.entries(sessions)) fs.writeFileSync(path.join(dir, `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return path.join(root, 'claude');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-run-'));
fs.mkdirSync(SHOTS, { recursive: true });
// Своя папка настроек — и своя блокировка одного экземпляра: запуск не мешает установленному приложению.
const userData = seed(root);
const env = { ...process.env, CLAUDE_CONFIG_DIR: seedTranscript(root, path.join(root, 'demo')) };
const app = await electron.launch({ executablePath: exe, args: [REPO, `--user-data-dir=${userData}`], env, timeout: 30_000 });
const page = await app.firstWindow();
// Playwright по умолчанию подменяет prefers-color-scheme на light: без сброса тёмная тема не включается.
await page.emulateMedia({ colorScheme: null });
await page.waitForSelector('.board', { timeout: 20_000 });
page.setDefaultTimeout(5_000); // неверный селектор — ошибка за 5 с, а не за 30
console.log('ready:', await page.title(), '·', root);

const COMMANDS = {
	async ss(arg) {
		const [name = `ss-${Date.now()}`, ...clip] = arg.split(' ').filter(Boolean);
		const [x, y, width, height] = clip.map(Number);
		const file = path.join(SHOTS, `${name}.png`);
		await page.screenshot({ path: file, clip: clip.length === 4 ? { x, y, width, height } : undefined });
		console.log('screenshot:', file);
	},
	click: (sel) => page.click(sel),
	hover: (sel) => page.hover(sel),
	async eval(js) {
		console.log(JSON.stringify(await page.evaluate(js), null, 1));
	},
	// Тема через меню, как у пользователя. Кнопка меню переключает popover: открытое меню повторный клик закрыл бы.
	async theme(v) {
		if (!(await page.$eval('#app-menu', (e) => e.matches(':popover-open')))) await page.click('.menu-btn');
		await page.click(`#app-menu button:has-text("${v === 'dark' ? 'Тёмная' : 'Светлая'}")`);
		await page.keyboard.press('Escape');
	},
	wait: (ms) => page.waitForTimeout(Number(ms)),
};

try {
	for (const line of process.argv.slice(2)) {
		const [cmd, ...rest] = line.split(' ');
		const run = COMMANDS[cmd];
		if (!run) throw new Error(`Нет команды «${cmd}». Есть: ${Object.keys(COMMANDS).join(', ')}`);
		console.log('>', line);
		await run(rest.join(' '));
		await page.waitForTimeout(300); // перерисовка после действия
	}
} finally {
	await app.close();
	fs.rmSync(root, { recursive: true, force: true });
}
