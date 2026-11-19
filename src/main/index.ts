// Основной процесс: окно, трей, автозапуск, проекты и слежение за их файлами.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, Tray } from 'electron';
import icon from '../../resources/icon.png?asset';
import { DOCS_DIR, isTaskDocsPath } from '../core/groups';
import { launchBlock, launchPrompt, wtArgs } from '../core/launch';
import { isViewable, resolveLink } from '../core/links';
import { CLAUDE_FILE, ISSUES_FILE, RULES_SOURCE } from '../core/rules';
import { sessionsIn, type Session } from '../core/sessions';
import type { WorktreeRef } from '../core/worktrees';
import type { AppState, ProjectView } from '../shared/api';
import {
	closeTask,
	createBaseGroups,
	dropPrMarks,
	headWithin,
	listWorktrees,
	loadRules,
	moveTask,
	projectBoard,
	projectOverlaps,
	prUrls,
	samePath,
	syncRules,
	type Rules,
} from './project';
import { branchPr, prState } from './github';
import { readSessions, SESSIONS_DIR } from './sessions';
import { loadSettings, saveSettings, type Settings } from './store';
import { watch } from './watch';

// Эталон правил по умолчанию: папка rules репозитория приложения, из которого его собрали (Q17).
// Копии в установщике нет: она устаревала бы и молча писала старые правила в проекты.
declare const __RULES_DIR__: string;
const WORKTREE_REFRESH_MS = 60_000;
const PR_CHECK_MS = 5 * 60_000;
const RULES_DIR_CHECK_MS = 60_000;
// Сессия, которая упала и не удалила свой файл, не даёт события слежения: живые процессы сверяются раз в 15 с.
const SESSIONS_CHECK_MS = 15_000;

let settings: Settings;
let sessions: Session[] = [];
let rules: Rules | null = null;
let rulesError: string | null = null;
let win: BrowserWindow | null = null;
let quitting = false;

interface Live {
	worktrees: WorktreeRef[];
	view: Omit<ProjectView, 'sessions'> | null; // null — доска ещё не прочитана; сессии добавляет state()
	unwatch: () => void;
	notices: string[]; // ошибки синхронизации правил
	merged: string[]; // пути worktree, чей PR влит, а коммиты все вошли в PR
}
const live = new Map<string, Live>();

function refresh(root: string) {
	const p = live.get(root);
	if (!p) return;
	// Строки только для worktree, которые ещё есть: удалённый worktree уходит с вкладки со списком worktree, без ожидания gh.
	const merged = p.worktrees
		.filter((w) => p.merged.includes(w.path))
		.map((w) => `Worktree ${w.path}: PR ветки ${w.branch} влит, папку можно удалить: git worktree remove "${w.path}"`);
	const notices = [...(rulesError ? [rulesError] : []), ...p.notices, ...merged];
	let groups: ProjectView['groups'] = [];
	try {
		groups = projectBoard(root, p.worktrees);
	} catch (e) {
		notices.push(`Не удалось прочитать задачи: ${(e as Error).message}`);
	}
	const overlaps = rules ? projectOverlaps(root, rules, settings.reviewed[root] ?? []) : [];
	p.view = { path: root, name: path.basename(root), groups, overlaps, notices };
	push();
}

// Сессии меняют статус часто: доски не перечитываются, в окно уходит только новое состояние.
function updateSessions() {
	const next = readSessions();
	if (JSON.stringify(next) === JSON.stringify(sessions)) return;
	sessions = next;
	push();
}

// Слежение за папкой сессий ставится, когда папка есть: до первого запуска Claude Code её нет.
let sessionsWatched = false;
function watchSessions() {
	if (sessionsWatched || !fs.existsSync(SESSIONS_DIR)) return;
	sessionsWatched = true;
	watch([{ dir: SESSIONS_DIR, recursive: false, accept: (f) => f.endsWith('.json') }], updateSessions);
}

function state(): AppState {
	const projects: ProjectView[] = [];
	for (const root of settings.projects) {
		const p = live.get(root);
		if (p?.view) projects.push({ ...p.view, sessions: sessionsIn([root, ...p.worktrees.map((w) => w.path)], sessions) });
	}
	return {
		projects,
		active: settings.active,
		rulesDir: settings.rulesDir,
	};
}
// Окно в трее не получает состояние: при показе оно получит его целиком.
const push = () => win?.isVisible() && win.webContents.send('state', state());

// Слежение: корень проекта (CLAUDE.md, CLAUDE-ISSUES.md), docs проекта и docs каждого worktree.
function rewatch(root: string) {
	const p = live.get(root);
	if (!p) return;
	p.unwatch();
	const docs = (dir: string) => ({ dir: path.join(dir, DOCS_DIR), recursive: true, accept: isTaskDocsPath });
	p.unwatch = watch(
		[{ dir: root, recursive: false, accept: (f) => f === CLAUDE_FILE || f === ISSUES_FILE }, docs(root), ...p.worktrees.map((w) => docs(w.path))],
		() => refresh(root),
	);
}

async function updateWorktrees(root: string) {
	const p = live.get(root);
	if (!p) return;
	const next = await listWorktrees(root);
	if (JSON.stringify(next) === JSON.stringify(p.worktrees)) return;
	p.worktrees = next;
	rewatch(root);
	refresh(root);
}

// Состояние PR на GitHub: отметки «PR» влитых и закрытых PR снимаются, worktree с влитой веткой — строка на вкладке.
async function checkPrs(root: string) {
	const p = live.get(root);
	if (!p) return;
	const urls = prUrls(root, p.worktrees);
	const worktrees = p.worktrees;
	// Запросы независимы: идут одновременно.
	// Ветку с тем же именем могли продолжить после слияния: удалить можно, только если в worktree нет коммитов сверх PR.
	const removable = async (w: WorktreeRef) => {
		const pr = await branchPr(root, w.branch);
		return pr?.state === 'MERGED' && (await headWithin(w.path, pr.head));
	};
	const [urlStates, removables] = await Promise.all([Promise.all(urls.map((url) => prState(root, url))), Promise.all(worktrees.map(removable))]);
	const done = new Set(urls.filter((_, i) => urlStates[i] === 'MERGED' || urlStates[i] === 'CLOSED'));
	const merged = worktrees.filter((_, i) => removables[i]).map((w) => w.path);
	if (live.get(root) !== p) return; // проект убрали, пока шли запросы
	const dropped = done.size > 0 && dropPrMarks(root, p.worktrees, done);
	if (!dropped && JSON.stringify(merged) === JSON.stringify(p.merged)) return;
	p.merged = merged;
	refresh(root);
}

function openProject(root: string) {
	if (live.has(root)) return;
	const p: Live = { worktrees: [], view: null, unwatch: () => {}, notices: [], merged: [] };
	live.set(root, p);
	if (rules) p.notices = syncRules(root, rules);
	rewatch(root);
	refresh(root);
	// PR проверяются после списка worktree: отметки и ветки есть и в них.
	void updateWorktrees(root).then(() => checkPrs(root));
}

function closeProject(root: string) {
	live.get(root)?.unwatch();
	live.delete(root);
}

function reloadRules() {
	try {
		rules = loadRules(settings.rulesDir);
		rulesError = null;
	} catch (e) {
		rules = null;
		rulesError = `Эталон правил: ${(e as Error).message}`;
	}
	for (const [root, p] of live) {
		p.notices = rules ? syncRules(root, rules) : [];
		refresh(root);
	}
}

let unwatchRules = () => {};
let rulesDirFound: boolean | undefined;

// Слежение и чтение эталона заново — при запуске, выборе папки и когда папка пропала или появилась.
// Сетевой или USB-диск пропадает без события слежения, поэтому наличие папки сверяется раз в минуту.
function syncRulesDir(force: boolean) {
	const found = fs.existsSync(settings.rulesDir);
	if (!force && found === rulesDirFound) return;
	rulesDirFound = found;
	unwatchRules();
	unwatchRules = watch([{ dir: settings.rulesDir, recursive: false }], reloadRules);
	reloadRules();
}

function persist() {
	saveSettings(settings);
	push();
}

function createWindow(show: boolean) {
	win = new BrowserWindow({
		width: 1400,
		height: 900,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? '#191e24' : '#f7f6f2', // --bg тем из app.css до первой отрисовки: окно не мигает
		title: 'Claude Projects',
		icon,
		webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
	});
	win.on('ready-to-show', () => show && win?.show());
	win.on('show', () => win?.webContents.send('state', state()));
	// Крестик прячет окно в трей: приложение продолжает следить за файлами.
	win.on('close', (e) => {
		if (!quitting) {
			e.preventDefault();
			win?.hide();
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (e) => e.preventDefault());
	if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function showWindow() {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

let tray: Tray | null = null;
function createTray() {
	tray = new Tray(icon);
	tray.setToolTip('Claude Projects');
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: 'Открыть', click: showWindow },
			{
				label: 'Выход',
				click: () => {
					quitting = true;
					app.quit();
				},
			},
		]),
	);
	tray.on('click', showWindow);
}

function ipc() {
	ipcMain.handle('state', () => state());
	ipcMain.handle('addProject', async () => {
		const res = await dialog.showOpenDialog(win!, { title: 'Папка проекта', properties: ['openDirectory'] });
		const root = res.filePaths[0];
		if (res.canceled || !root) return;
		// Тот же проект в другом регистре пути (C:\Proj и c:\proj) — та же вкладка.
		const known = settings.projects.find((r) => samePath(r, root));
		if (!known) {
			try {
				createBaseGroups(root);
			} catch (e) {
				await dialog.showMessageBox(win!, { type: 'error', title: 'Папка проекта', message: `Не удалось создать файлы задач в ${root}`, detail: (e as Error).message });
				return;
			}
			settings.projects.push(root);
			openProject(root);
		}
		settings.active = known ?? root;
		persist();
	});
	ipcMain.handle('removeProject', (_e, root: string) => {
		closeProject(root);
		settings.projects = settings.projects.filter((r) => r !== root);
		delete settings.reviewed[root];
		if (settings.active === root) settings.active = settings.projects[0] ?? null;
		persist();
	});
	ipcMain.handle('setActive', (_e, root: string) => {
		settings.active = root;
		persist();
	});
	ipcMain.handle('move', (_e, root: string, id: string, to: string) => (live.has(root) ? moveTask(root, id, to) : 'Нет такого проекта'));
	ipcMain.handle('close', (_e, root: string, id: string) => {
		const p = live.get(root);
		return p ? closeTask(root, id, p.worktrees) : 'Нет такого проекта';
	});
	ipcMain.handle('reviewed', (_e, root: string, key: string) => {
		(settings.reviewed[root] ??= []).push(key);
		saveSettings(settings);
		refresh(root);
	});
	ipcMain.handle('open', async (_e, root: string, href: string, from: string) => {
		const link = live.has(root) ? resolveLink(root, from, href) : null;
		if (!link) return;
		if ('url' in link) return void shell.openExternal(link.url);
		const st = fs.statSync(link.file, { throwIfNoEntry: false });
		if (!st) return;
		if (st.isDirectory() || isViewable(link.file)) await shell.openPath(link.file);
		else shell.showItemInFolder(link.file);
	});
	ipcMain.handle('chooseRulesDir', async () => {
		const res = await dialog.showOpenDialog(win!, { title: 'Папка эталона правил', defaultPath: settings.rulesDir, properties: ['openDirectory'] });
		const dir = res.filePaths[0];
		if (res.canceled || !dir) return;
		settings.rulesDir = dir;
		saveSettings(settings);
		syncRulesDir(true);
	});
	ipcMain.handle('openRules', async () => {
		await shell.openPath(path.join(settings.rulesDir, RULES_SOURCE));
	});
	// Тема окна — через nativeTheme: prefers-color-scheme окна следует themeSource, состояние слать не нужно.
	ipcMain.handle('setTheme', (_e, dark: boolean) => {
		settings.theme = nativeTheme.themeSource = dark ? 'dark' : 'light';
		saveSettings(settings);
	});
	ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(text));
	// Задачу берём из прочитанной доски, а не из окна: в терминал уходит только текст из файлов проекта.
	ipcMain.handle('launch', async (_e, root: string, id: string): Promise<string | null> => {
		const card = live.get(root)?.view?.groups.flatMap((g) => g.cards).find((c) => c.id === id);
		if (!card) return 'Нет такой задачи';
		const block = launchBlock(card);
		if (block) return block;
		const child = spawn('wt.exe', wtArgs(root, launchPrompt(card)), { detached: true, stdio: 'ignore' });
		child.unref();
		return new Promise((resolve) => {
			child.on('spawn', () => resolve(null));
			child.on('error', (e) => resolve(`Не удалось запустить Windows Terminal: ${e.message}`));
		});
	});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', showWindow);
	app.on('before-quit', () => (quitting = true));
	// Окно спрятано в трей — приложение работает дальше.
	app.on('window-all-closed', () => {});
	void app.whenReady().then(() => {
		// Папку эталона нет на месте (диск не подключён) — путь в настройках остаётся, на вкладках видна ошибка эталона.
		settings = loadSettings(__RULES_DIR__);
		// Прежние версии брали копию эталона из установщика: путь к ней больше никуда не ведёт.
		if (samePath(settings.rulesDir, path.join(process.resourcesPath, 'rules'))) {
			settings.rulesDir = __RULES_DIR__;
			saveSettings(settings);
		}
		// Автозапуск включается один раз: если пользователь выключит его в Windows, приложение не включит снова.
		if (app.isPackaged && !settings.autostart) {
			app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
			settings.autostart = true;
			saveSettings(settings);
		}
		// Окно — первым: доски проектов читаются после и приходят в окно сами.
		ipc();
		nativeTheme.themeSource = settings.theme ?? 'system';
		createWindow(!process.argv.includes('--hidden'));
		createTray();
		syncRulesDir(true);
		sessions = readSessions();
		for (const root of settings.projects) openProject(root);
		watchSessions();
		setInterval(() => {
			watchSessions();
			updateSessions();
		}, SESSIONS_CHECK_MS);
		setInterval(() => settings.projects.forEach((r) => void updateWorktrees(r)), WORKTREE_REFRESH_MS);
		setInterval(() => settings.projects.forEach((r) => void checkPrs(r)), PR_CHECK_MS);
		setInterval(() => syncRulesDir(false), RULES_DIR_CHECK_MS);
	});
}
