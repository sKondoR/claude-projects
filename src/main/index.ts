// Основной процесс: окно, трей, автозапуск, проекты и слежение за их файлами.
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, Tray } from 'electron';
import icon from '../../resources/icon.png?asset';
import type { AppState, ProjectView } from '../shared/api';
import {
	closeTask,
	createBaseGroups,
	isTaskDocsPath,
	listWorktrees,
	loadRules,
	moveTask,
	projectBoard,
	projectOverlaps,
	samePath,
	syncRules,
	type Rules,
	type WorktreeRef,
} from './project';
import { loadSettings, saveSettings, type Settings } from './store';
import { watch } from './watch';

declare const __RULES_DIR__: string;

// Эталон правил: папка rules репозитория приложения, из которой его собрали; если её нет — копия в сборке.
const defaultRulesDir = () => (fs.existsSync(__RULES_DIR__) ? __RULES_DIR__ : path.join(process.resourcesPath, 'rules'));
const WORKTREE_REFRESH_MS = 60_000;

let settings: Settings;
let rules: Rules | null = null;
let rulesError: string | null = null;
let win: BrowserWindow | null = null;
let quitting = false;

interface Live {
	worktrees: WorktreeRef[];
	view: ProjectView | null; // null — доска ещё не прочитана
	unwatch: () => void;
	notices: string[]; // ошибки синхронизации правил
}
const live = new Map<string, Live>();

const nameOf = (p: string) => path.basename(p);

function refresh(root: string) {
	const p = live.get(root);
	if (!p) return;
	const notices = [...(rulesError ? [rulesError] : []), ...p.notices];
	let groups: ProjectView['groups'] = [];
	try {
		groups = projectBoard(root, p.worktrees);
	} catch (e) {
		notices.push(`Не удалось прочитать задачи: ${(e as Error).message}`);
	}
	const overlaps = rules ? projectOverlaps(root, rules, settings.reviewed[root] ?? []) : [];
	p.view = { path: root, name: nameOf(root), groups, overlaps, notices };
	push();
}

function state(): AppState {
	return {
		projects: settings.projects.map((r) => live.get(r)?.view).filter((v) => !!v),
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
	const docs = (dir: string) => ({ dir: path.join(dir, 'docs'), recursive: true, accept: isTaskDocsPath });
	p.unwatch = watch(
		[{ dir: root, recursive: false, accept: (f) => f === 'CLAUDE.md' || f === 'CLAUDE-ISSUES.md' }, docs(root), ...p.worktrees.map((w) => docs(w.path))],
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

function openProject(root: string) {
	if (live.has(root)) return;
	const p: Live = { worktrees: [], view: null, unwatch: () => {}, notices: [] };
	live.set(root, p);
	if (rules) p.notices = syncRules(root, rules);
	rewatch(root);
	refresh(root);
	void updateWorktrees(root);
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
function watchRules() {
	unwatchRules();
	unwatchRules = watch([{ dir: settings.rulesDir, recursive: false }], reloadRules);
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

// Путь внутри проекта: ссылка из карточки не выводит за его пределы.
function insideProject(root: string, target: string) {
	const rel = path.relative(root, target);
	return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Файлы, которые Windows откроет программой просмотра, а не запустит. Остальные (.bat, .exe, .js, …) показываются в Проводнике.
const VIEWABLE = new Set(['.md', '.txt', '.log', '.json', '.yml', '.yaml', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

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
		if (/^https?:\/\//.test(href)) return void shell.openExternal(href);
		if (!live.has(root) || /^[a-z]+:/i.test(href)) return;
		let file = href.split('#')[0]!;
		try {
			file = decodeURIComponent(file);
		} catch {
			// Неверная %-последовательность: имя файла берётся как написано.
		}
		const target = path.resolve(root, from, file);
		const st = insideProject(root, target) ? fs.statSync(target, { throwIfNoEntry: false }) : undefined;
		if (!st) return;
		if (st.isDirectory() || VIEWABLE.has(path.extname(target).toLowerCase())) await shell.openPath(target);
		else shell.showItemInFolder(target);
	});
	ipcMain.handle('chooseRulesDir', async () => {
		const res = await dialog.showOpenDialog(win!, { title: 'Папка эталона правил', defaultPath: settings.rulesDir, properties: ['openDirectory'] });
		const dir = res.filePaths[0];
		if (res.canceled || !dir) return;
		settings.rulesDir = dir;
		saveSettings(settings);
		watchRules();
		reloadRules();
	});
	ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(text));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', showWindow);
	app.on('before-quit', () => (quitting = true));
	// Окно спрятано в трей — приложение работает дальше.
	app.on('window-all-closed', () => {});
	void app.whenReady().then(() => {
		settings = loadSettings(defaultRulesDir());
		if (!fs.existsSync(settings.rulesDir)) settings.rulesDir = defaultRulesDir();
		// Автозапуск включается один раз: если пользователь выключит его в Windows, приложение не включит снова.
		if (app.isPackaged && !settings.autostart) {
			app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
			settings.autostart = true;
			saveSettings(settings);
		}
		// Окно — первым: доски проектов читаются после и приходят в окно сами.
		ipc();
		createWindow(!process.argv.includes('--hidden'));
		createTray();
		reloadRules();
		watchRules();
		for (const root of settings.projects) openProject(root);
		setInterval(() => settings.projects.forEach((r) => void updateWorktrees(r)), WORKTREE_REFRESH_MS);
	});
}
