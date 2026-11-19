import { CLAUDE_FILE } from './rules';

// Папки проекта: задачи и закрытые задачи.
export const DOCS_DIR = 'docs';
const ISSUES = 'issues';
const RESOLVED = 'resolved';
export const ISSUES_DIR = `${DOCS_DIR}/${ISSUES}`;
export const RESOLVED_DIR = `${DOCS_DIR}/${RESOLVED}`;

// Путь из события слежения за docs/: файлы задач и закрытых задач.
export const isTaskDocsPath = (rel: string) => [ISSUES, RESOLVED].includes(rel.split(/[\\/]/)[0]!);

// Группы задач: файлы docs/issues/*.md. Базовый набор создаётся в новом проекте; другие файлы тоже становятся столбцами.
export const BASE_GROUPS = [
	{ file: 'issues.md', title: 'Задачи' },
	{ file: 'security-issues.md', title: 'Безопасность' },
	{ file: 'architecture-issues.md', title: 'Архитектура' },
	{ file: 'other-issues.md', title: 'Прочее' },
	{ file: 'backlog.md', title: 'Бэклог' },
];
const BACKLOG = 'backlog.md';
const BASE_ORDER = BASE_GROUPS.map((g) => g.file).filter((f) => f !== BACKLOG);

// docs/issues/CLAUDE.md — старые правила проекта, не группа задач.
export const isGroupFile = (file: string) => file.endsWith('.md') && file !== CLAUDE_FILE;

export const keyOf = (file: string) => file.replace(/\.md$/, '');
export const isBacklog = (group: string) => group === keyOf(BACKLOG);

// Базовые по порядку набора, затем прочие по алфавиту, бэклог последним.
const rank = (f: string) => (f === BACKLOG ? Infinity : BASE_ORDER.includes(f) ? BASE_ORDER.indexOf(f) : BASE_ORDER.length);
export const compareGroups = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);

// Файл закрытых задач в docs/resolved: бэклог закрывается вместе с основными задачами.
export const doneFileOf = (file: string) => (file === BACKLOG ? 'issues-DONE.md' : file.replace(/\.md$/, '-DONE.md'));

// Название столбца: первая строка «# …» файла, иначе имя файла.
export const titleOf = (text: string, file: string) => /^# (.+)$/m.exec(text)?.[1]?.trim() ?? keyOf(file);
