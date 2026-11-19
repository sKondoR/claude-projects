// Файлы проекта: базовые группы, управляемые блоки правил, доска, перенос и закрытие задач.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildBoard, latestMarks, type BoardGroup, type Worktree } from '../core/board';
import { closeCard, doneNote, moveCard } from '../core/edit';
import { BASE_GROUPS, doneFileOf, isGroupFile, ISSUES_DIR, RESOLVED_DIR } from '../core/groups';
import { HOOK_SCRIPT, isOwnPrePush, PRE_PUSH_SCRIPT, prePushText, SETTINGS_FILE, settingsWithHooks } from '../core/hooks';
import { findOverlaps, type Overlap } from '../core/overlap';
import { closedIdsOf, idsOf } from '../core/parse';
import { blockRange, CLAUDE_FILE, claudeMdText, ISSUES_FILE, issuesFileText, LOCAL_FILE, POINTER_BLOCK, RULES_SOURCE } from '../core/rules';
import { hash } from '../core/text';
import type { Mark, MdFile } from '../core/types';
import { parseWorktrees, type WorktreeRef } from '../core/worktrees';
import { listMd, readText, writeAtomic, writeIfChanged } from './files';

const STATUS_FILE = 'status.json';
const SCRIPT_FILE = 'issues-status.mjs';

export interface Rules {
	rules: string;
	pointer: string;
	script: string;
	hook: string; // скрипт хука доски
	prePush: string; // скрипт проверки git pre-push
	local: string; // начальный текст CLAUDE-ISSUES-LOCAL.md
}

export function loadRules(dir: string): Rules {
	const read = (f: string) => {
		const text = readText(path.join(dir, f));
		if (text === null) throw new Error(`Нет файла эталона ${path.join(dir, f)}`);
		return text;
	};
	return { rules: read(RULES_SOURCE), pointer: read('pointer.md'), script: read(SCRIPT_FILE), hook: read(HOOK_SCRIPT), prePush: read(PRE_PUSH_SCRIPT), local: read('local.md') };
}

// Недостающие файлы базового набора групп. Существующие файлы задач не трогаются.
export function createBaseGroups(root: string) {
	for (const g of BASE_GROUPS) {
		const file = path.join(root, ISSUES_DIR, g.file);
		if (!fs.existsSync(file)) writeAtomic(file, `# ${g.title}\n`);
	}
}

// Блок общих правил в CLAUDE-ISSUES.md, ссылка в CLAUDE.md, скрипты, хук в .claude/settings.json и git pre-push. Возвращает ошибки.
export function syncRules(root: string, rules: Rules): string[] {
	const errors: string[] = [];
	const sync = (file: string, make: (old: string | null) => string) => {
		try {
			writeIfChanged(path.join(root, file), make(readText(path.join(root, file))));
		} catch (e) {
			errors.push(`${file}: ${(e as Error).message}`);
		}
	};
	sync(ISSUES_FILE, (old) => issuesFileText(old, rules.rules));
	sync(CLAUDE_FILE, (old) => claudeMdText(old, rules.pointer));
	sync(path.join(ISSUES_DIR, SCRIPT_FILE), () => rules.script);
	sync(path.join(ISSUES_DIR, HOOK_SCRIPT), () => rules.hook);
	sync(SETTINGS_FILE, settingsWithHooks);
	sync(path.join(ISSUES_DIR, PRE_PUSH_SCRIPT), () => rules.prePush);
	errors.push(...syncPrePush(root));
	sync(LOCAL_FILE, (old) => old ?? rules.local); // правила проекта: только создать, если файла нет
	return errors;
}

const groupsOf = (root: string): MdFile[] =>
	listMd(path.join(root, ISSUES_DIR), isGroupFile).map((file) => ({ file, text: readText(path.join(root, ISSUES_DIR, file)) ?? '' }));

// Номера закрытых задач по файлам docs/resolved/*-DONE.md. Файлы большие (до сотен КБ) и меняются редко,
// поэтому номера файла кешируются до изменения его времени или размера.
const closedCache = new Map<string, { stamp: string; ids: string[] }>();
function closedOf(root: string): Set<string> {
	const dir = path.join(root, RESOLVED_DIR);
	const ids = new Set<string>();
	const files = listMd(dir, (f) => f.endsWith('-DONE.md')).map((f) => path.join(dir, f));
	// Удалённые файлы уходят из кеша.
	for (const file of closedCache.keys()) if (path.dirname(file) === dir && !files.includes(file)) closedCache.delete(file);
	for (const file of files) {
		const st = fs.statSync(file, { throwIfNoEntry: false });
		if (!st) continue;
		const stamp = `${st.mtimeMs}:${st.size}`;
		let entry = closedCache.get(file);
		if (entry?.stamp !== stamp) closedCache.set(file, (entry = { stamp, ids: closedIdsOf(readText(file) ?? '') }));
		for (const id of entry.ids) ids.add(id);
	}
	return ids;
}

const statusFile = (root: string) => path.join(root, ISSUES_DIR, STATUS_FILE);

function readMarks(root: string): Mark[] {
	try {
		const list = JSON.parse(readText(statusFile(root)) ?? '[]');
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

// Формат как у rules/issues-status.mjs: пустой список удаляет файл.
function writeMarks(root: string, list: Mark[]) {
	if (list.length) writeAtomic(statusFile(root), JSON.stringify(list, null, 2) + '\n');
	else fs.rmSync(statusFile(root), { force: true });
}

const execFileAsync = promisify(execFile);
export const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Ближайшая папка с .git от root вверх; null — проект не в git, и git не запускается.
function gitTopOf(root: string): string | null {
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, '.git'))) return dir;
		if (path.dirname(dir) === dir) return null;
	}
}

// Репозитории проекта: тот, где лежит папка проекта, а если её нет в git — репозитории в подпапках до второго уровня
// (документы и задачи в папке проекта, код в подпапке). Зависимости и скрытые папки не просматриваются.
function gitReposOf(root: string): string[] {
	if (gitTopOf(root)) return [root];
	const found: string[] = [];
	const scan = (dir: string, depth: number) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (e) {
			if (dir === root) throw e; // папку проекта не прочитать — ошибка на вкладке
			return; // подпапку нельзя прочитать: остальные просматриваются
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
			const sub = path.join(dir, e.name);
			if (fs.existsSync(path.join(sub, '.git'))) found.push(sub);
			else if (depth > 1) scan(sub, depth - 1);
		}
	};
	scan(root, 2);
	return found;
}

// git pre-push в каждом репозитории проекта. Нет репозитория — ошибка на вкладке, а не тихий пропуск.
function syncPrePush(root: string): string[] {
	const fail = (reason: string, where = root) => `pre-push: ${reason}, проверка задач перед push в ${where} не установлена`;
	let repos: string[];
	try {
		repos = gitReposOf(root);
	} catch (e) {
		return [fail((e as Error).message)];
	}
	if (!repos.length) return [fail('в папке проекта и её подпапках нет git-репозитория')];
	return repos.flatMap((repo) => {
		try {
			installPrePush(repo, path.join(root, ISSUES_DIR, PRE_PUSH_SCRIPT));
			return [];
		} catch (e) {
			return [fail((e as Error).message, repo)];
		}
	});
}

// Чужой хук и свой путь хуков (core.hooksPath, например husky) не трогаются: ошибка на вкладке.
// --git-path hooks уже учитывает core.hooksPath: путь не в .git/hooks — путь хуков свой.
function installPrePush(repo: string, script: string) {
	const out = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'hooks'], { encoding: 'utf8', windowsHide: true });
	const [gitDir = '', hooksDir = ''] = out.trim().split(/\r?\n/);
	if (!samePath(hooksDir, path.join(gitDir, 'hooks'))) throw new Error(`в репозитории свой путь хуков core.hooksPath (${hooksDir})`);
	const file = path.join(hooksDir, 'pre-push');
	const old = readText(file);
	if (old !== null && !isOwnPrePush(old)) throw new Error(`в репозитории свой хук ${file}`);
	writeIfChanged(file, prePushText(script));
	fs.chmodSync(file, 0o755);
}

// Другие рабочие копии репозитория проекта (git worktree). Проект может быть подпапкой репозитория:
// в каждой копии берётся та же подпапка; копии, где её нет (старая ветка), доске не нужны.
export async function listWorktrees(root: string): Promise<WorktreeRef[]> {
	const top = gitTopOf(root);
	if (!top) return [];
	try {
		const { stdout } = await execFileAsync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], { windowsHide: true });
		const sub = path.relative(top, root);
		return parseWorktrees(stdout)
			.map((w) => ({ ...w, path: path.join(w.path, sub) }))
			.filter((w) => !samePath(w.path, root) && fs.existsSync(w.path));
	} catch {
		return [];
	}
}

// Рабочую копию можно удалить без потерь: нет несохранённых и новых файлов, все коммиты входят в коммит sha (например, последний коммит PR).
// Нет коммита sha локально или git не ответил — false.
export async function removableAt(dir: string, sha: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync('git', ['-C', dir, 'status', '--porcelain'], { windowsHide: true });
		if (stdout) return false;
		await execFileAsync('git', ['-C', dir, 'merge-base', '--is-ancestor', 'HEAD', sha], { windowsHide: true });
		return true;
	} catch {
		return false;
	}
}

// Корень проекта и его worktree: у каждой копии свои файлы задач и свой status.json.
const copiesOf = (root: string, worktrees: WorktreeRef[]) => [root, ...worktrees.map((w) => w.path)];

export function projectBoard(root: string, worktrees: WorktreeRef[]): BoardGroup[] {
	const wts: Worktree[] = worktrees.map((w) => ({ branch: w.branch, groups: groupsOf(w.path), closed: closedOf(w.path) }));
	const marks = copiesOf(root, worktrees).flatMap(readMarks);
	return buildBoard({ groups: groupsOf(root), closed: closedOf(root), marks, worktrees: wts }).groups;
}

// Пересечения общих правил с собственным текстом корневого CLAUDE.md проекта. Блок-ссылку вставило приложение,
// а правила, подключённые через неё, скопированы из эталона: их не сравниваем.
// Ответ зависит только от CLAUDE.md и эталона: между их изменениями он берётся из кеша.
const overlapCache = new Map<string, { stamp: string; overlaps: Overlap[] }>();

export function projectOverlaps(root: string, rules: Rules, reviewed: string[]): Overlap[] {
	const file = path.join(root, CLAUDE_FILE);
	const stamp = `${hash(rules.rules)}:${fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? '-'}`;
	let entry = overlapCache.get(root);
	if (entry?.stamp !== stamp) {
		const text = readText(file);
		let skip: [number, number] | undefined;
		try {
			skip = text === null ? undefined : (blockRange(text, POINTER_BLOCK) ?? undefined);
		} catch {
			// Сломанный маркер покажет syncRules; здесь сравниваем весь файл.
		}
		const sources = text === null ? [] : [{ file: CLAUDE_FILE, text, skip }];
		overlapCache.set(root, (entry = { stamp, overlaps: findOverlaps(rules.rules, sources) }));
	}
	const done = new Set(reviewed);
	return entry.overlaps.filter((o) => !done.has(o.key));
}

// Файл группы, где лежит открытая задача.
function sourceOf(root: string, id: string): string | null {
	const g = groupsOf(root).find((f) => idsOf(f.text).includes(id));
	return g ? path.join(root, ISSUES_DIR, g.file) : null;
}

type Edit = (src: string, dst: string) => { src: string; dst: string } | null;

// Правка двух файлов: если файл изменился между чтением и записью, операция повторяется.
// Сначала пишется dst (куда задача уходит): при сбое задача окажется в двух местах, а не потеряется.
function editPair(srcFile: string, dstFile: string, edit: Edit): string | null {
	const read = (f: string) => readText(f) ?? '';
	for (let attempt = 0; attempt < 3; attempt++) {
		const src = read(srcFile);
		const dst = read(dstFile);
		const result = edit(src, dst);
		if (!result) return 'Задача не найдена в файле';
		if (read(srcFile) !== src || read(dstFile) !== dst) continue;
		writeAtomic(dstFile, result.dst);
		writeAtomic(srcFile, result.src);
		return null;
	}
	return 'Файлы задач всё время меняются, попробуйте ещё раз';
}

export function moveTask(root: string, id: string, toGroup: string): string | null {
	const from = sourceOf(root, id);
	if (!from) return `Нет открытой задачи ${id}`;
	// Только файл группы: не docs/issues/CLAUDE.md и не путь за пределами docs/issues.
	if (!listMd(path.join(root, ISSUES_DIR), isGroupFile).includes(`${toGroup}.md`)) return `Нет группы ${toGroup}`;
	const to = path.join(root, ISSUES_DIR, `${toGroup}.md`);
	if (samePath(from, to)) return null;
	return editPair(from, to, (src, dst) => moveCard(src, dst, id));
}

// Адреса PR в отметках «PR» всех рабочих копий.
export function prUrls(root: string, worktrees: WorktreeRef[]): string[] {
	const marks = copiesOf(root, worktrees).flatMap(readMarks);
	return [...new Set(marks.flatMap((m) => (m.status === 'pr' && m.url ? [m.url] : [])))];
}

// Снять отметки «PR» с этими адресами во всех рабочих копиях: PR влит или закрыт. Возвращает, снято ли что-то.
export function dropPrMarks(root: string, worktrees: WorktreeRef[], urls: Set<string>): boolean {
	let dropped = false;
	for (const dir of copiesOf(root, worktrees)) {
		const marks = readMarks(dir);
		const left = marks.filter((m) => !(m.status === 'pr' && m.url && urls.has(m.url)));
		if (left.length === marks.length) continue;
		writeMarks(dir, left);
		dropped = true;
	}
	return dropped;
}

// Отметку задачи могла поставить сессия в любой рабочей копии: PR берётся из самой поздней, как на доске; снимается во всех.
export function closeTask(root: string, id: string, worktrees: WorktreeRef[]): string | null {
	const from = sourceOf(root, id);
	if (!from) return `Нет открытой задачи ${id}`;
	const copies = copiesOf(root, worktrees).map((dir) => ({ dir, marks: readMarks(dir) }));
	const note = doneNote(new Date(), latestMarks(copies.flatMap((c) => c.marks)).get(id)?.url);
	const done = path.join(root, RESOLVED_DIR, doneFileOf(path.basename(from)));
	const error = editPair(from, done, (src, dst) => closeCard(src, dst, id, note));
	if (!error) for (const c of copies) if (c.marks.some((m) => m.id === id)) writeMarks(c.dir, c.marks.filter((m) => m.id !== id));
	return error;
}
