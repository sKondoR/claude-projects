// Файлы проекта: базовые группы, управляемые блоки правил, доска, перенос и закрытие задач.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildBoard, type BoardGroup, type Worktree } from '../core/board';
import { closeCard, doneNote, moveCard } from '../core/edit';
import { BASE_GROUPS, doneFileOf, isGroupFile } from '../core/groups';
import { findOverlaps, type Overlap } from '../core/overlap';
import { idsOf } from '../core/parse';
import { blockRange, claudeMdText, ISSUES_FILE, issuesFileText, POINTER_BLOCK, RULES_BLOCK } from '../core/rules';
import { hash } from '../core/text';
import type { Mark, MdFile } from '../core/types';
import { listMd, readText, writeAtomic, writeIfChanged } from './files';

const ISSUES = 'issues';
const RESOLVED = 'resolved';
export const ISSUES_DIR = path.join('docs', ISSUES);
const RESOLVED_DIR = path.join('docs', RESOLVED);
const STATUS_FILE = 'status.json';
const SCRIPT_FILE = 'issues-status.mjs';

// Путь из события слежения за docs/: файлы задач и закрытых задач.
export const isTaskDocsPath = (rel: string) => [ISSUES, RESOLVED].includes(rel.split(/[\\/]/)[0]!);

export interface Rules {
	rules: string;
	pointer: string;
	script: string;
}

export function loadRules(dir: string): Rules {
	const read = (f: string) => {
		const text = readText(path.join(dir, f));
		if (text === null) throw new Error(`Нет файла эталона ${path.join(dir, f)}`);
		return text;
	};
	return { rules: read('issues-rules.md'), pointer: read('pointer.md'), script: read(SCRIPT_FILE) };
}

// Недостающие файлы базового набора групп. Существующие файлы задач не трогаются.
export function createBaseGroups(root: string) {
	for (const g of BASE_GROUPS) {
		const file = path.join(root, ISSUES_DIR, g.file);
		if (!fs.existsSync(file)) writeAtomic(file, `# ${g.title}\n`);
	}
}

// Блок общих правил в CLAUDE-ISSUES.md, ссылка в CLAUDE.md и скрипт отметок. Возвращает ошибки.
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
	sync('CLAUDE.md', (old) => claudeMdText(old, rules.pointer));
	sync(path.join(ISSUES_DIR, SCRIPT_FILE), () => rules.script);
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
		if (entry?.stamp !== stamp) closedCache.set(file, (entry = { stamp, ids: idsOf(readText(file) ?? '') }));
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

export interface WorktreeRef {
	path: string;
	branch: string;
}

const run = promisify(execFile);
export const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Другие рабочие копии репозитория проекта (git worktree). Не git — пустой список без запуска git.
export async function listWorktrees(root: string): Promise<WorktreeRef[]> {
	if (!fs.existsSync(path.join(root, '.git'))) return [];
	try {
		const { stdout } = await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { windowsHide: true });
		const out: WorktreeRef[] = [];
		for (const entry of stdout.split(/\n\n/)) {
			const dir = /^worktree (.+)$/m.exec(entry)?.[1]?.trim();
			const branch = /^branch refs\/heads\/(.+)$/m.exec(entry)?.[1]?.trim();
			if (dir && branch && !samePath(dir, root)) out.push({ path: path.normalize(dir), branch });
		}
		return out;
	} catch {
		return [];
	}
}

export function projectBoard(root: string, worktrees: WorktreeRef[]): BoardGroup[] {
	const wts: Worktree[] = worktrees.map((w) => ({ branch: w.branch, groups: groupsOf(w.path), closed: closedOf(w.path) }));
	const marks = [root, ...worktrees.map((w) => w.path)].flatMap(readMarks);
	return buildBoard({ groups: groupsOf(root), closed: closedOf(root), marks, worktrees: wts }).groups;
}

// Пересечения зависят только от трёх файлов правил и эталона: между их изменениями ответ берётся из кеша.
const OVERLAP_FILES: [string, string | null][] = [
	['CLAUDE.md', POINTER_BLOCK],
	[ISSUES_FILE, RULES_BLOCK],
	[path.join(ISSUES_DIR, 'CLAUDE.md'), null],
];
const overlapCache = new Map<string, { stamp: string; overlaps: Overlap[] }>();

export function projectOverlaps(root: string, rules: Rules, reviewed: string[]): Overlap[] {
	const stamp = [hash(rules.rules), ...OVERLAP_FILES.map(([f]) => fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.mtimeMs ?? '-')].join(':');
	let entry = overlapCache.get(root);
	if (entry?.stamp !== stamp) {
		const sources = OVERLAP_FILES.flatMap(([file, block]) => {
			const text = readText(path.join(root, file));
			if (text === null) return [];
			let skip: [number, number] | undefined;
			try {
				skip = block ? (blockRange(text, block) ?? undefined) : undefined;
			} catch {
				// Сломанный маркер покажет syncRules; здесь сравниваем весь файл.
			}
			return [{ file: file.split(path.sep).join('/'), text, skip }];
		});
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

// Отметку задачи могла поставить сессия в любой рабочей копии: PR берётся из самой поздней, как на доске; снимается во всех.
export function closeTask(root: string, id: string, worktrees: WorktreeRef[]): string | null {
	const from = sourceOf(root, id);
	if (!from) return `Нет открытой задачи ${id}`;
	const copies = [root, ...worktrees.map((w) => w.path)].map((dir) => ({ dir, marks: readMarks(dir) }));
	const latest = copies
		.flatMap((c) => c.marks)
		.filter((m) => m.id === id)
		.reduce<Mark | undefined>((a, m) => (!a || a.at < m.at ? m : a), undefined);
	const note = doneNote(new Date(), latest?.url);
	const done = path.join(root, RESOLVED_DIR, doneFileOf(path.basename(from)));
	const error = editPair(from, done, (src, dst) => closeCard(src, dst, id, note));
	if (!error) for (const c of copies) if (c.marks.some((m) => m.id === id)) writeMarks(c.dir, c.marks.filter((m) => m.id !== id));
	return error;
}
