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

// Проект-пример: задачи с разным приоритетом, трудностью и риском; повтор общего правила в CLAUDE.md даёт ⚠ на вкладке.
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
			card('С3', 'Метрика', '**Приоритет:** Низкая · **Трудность:** Сложная · **Риск:** 0', 'Текст.'),
		].join('\n'),
	);
	fs.writeFileSync(path.join(demo, 'CLAUDE.md'), '# Проект\n\n- Находки проверок безопасности записывай сразу.\n');
	const settings = { projects: [demo, path.join(root, 'demo2')], active: demo, rulesDir: path.join(REPO, 'rules'), reviewed: {}, autostart: true, theme: 'light' };
	fs.mkdirSync(path.join(root, 'user-data'));
	fs.writeFileSync(path.join(root, 'user-data/settings.json'), JSON.stringify(settings, null, 2));
	return path.join(root, 'user-data');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-run-'));
fs.mkdirSync(SHOTS, { recursive: true });
// Своя папка настроек — и своя блокировка одного экземпляра: запуск не мешает установленному приложению.
const app = await electron.launch({ executablePath: exe, args: [REPO, `--user-data-dir=${seed(root)}`], timeout: 30_000 });
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
