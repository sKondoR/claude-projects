// Файловые операции проекта на временной папке: создание, синхронизация правил, доска, перенос, закрытие, отметки.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTask, createBaseGroups, loadRules, moveTask, projectBoard, projectOverlaps, syncRules } from './project';

const rules = loadRules(path.resolve('rules'));
let root: string;
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f: string, text: string) => {
	fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
	fs.writeFileSync(path.join(root, f), text);
};
const card = (id: string) => `### ${id} · Задача ${id}\n\n**Приоритет:** Средняя · **Риск:** 0\n\nТекст ${id}.\n`;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('новый проект', () => {
	it('создаёт базовые группы, правила, ссылку и скрипт', () => {
		write('CLAUDE.md', '# Проект\n\nКоманды.\n');
		createBaseGroups(root);
		expect(syncRules(root, rules)).toEqual([]);
		expect(read('docs/issues/issues.md')).toBe('# Задачи\n');
		expect(read('docs/issues/backlog.md')).toBe('# Бэклог\n');
		expect(read('CLAUDE.md')).toMatch(/^# Проект\n\nКоманды\.\n\n<!-- issues-pointer:start \w+ -->\n[\s\S]*@CLAUDE-ISSUES\.md\n<!-- issues-pointer:end -->\n$/);
		expect(read('CLAUDE-ISSUES.md')).toContain('## Правила проекта');
		expect(read('docs/issues/issues-status.mjs')).toBe(rules.script);
		expect(projectBoard(root, []).map((g) => g.key)).toEqual(['issues', 'security-issues', 'architecture-issues', 'other-issues', 'backlog']);
	});

	it('не трогает существующие файлы задач и раздел проекта при новой версии правил', () => {
		write('docs/issues/issues.md', '# Мои задачи\n\n' + card('С1'));
		createBaseGroups(root);
		syncRules(root, rules);
		fs.appendFileSync(path.join(root, 'CLAUDE-ISSUES.md'), 'Буквы: С — сайт.\n');
		syncRules(root, { ...rules, rules: '# Учёт задач\n\nНовое правило.' });
		expect(read('docs/issues/issues.md')).toBe('# Мои задачи\n\n' + card('С1'));
		expect(read('CLAUDE-ISSUES.md')).toMatch(/Новое правило\.\n<!-- issues-rules:end -->[\s\S]*Буквы: С — сайт\.\n$/);
	});

	it('сломанный маркер — сообщение, файл не меняется', () => {
		write('CLAUDE.md', '<!-- issues-pointer:start 1 -->\nстарое\n');
		expect(syncRules(root, rules)).toEqual([expect.stringMatching(/^CLAUDE\.md: Нет маркера/)]);
		expect(read('CLAUDE.md')).toBe('<!-- issues-pointer:start 1 -->\nстарое\n');
	});
});

describe('задачи', () => {
	beforeEach(() => {
		createBaseGroups(root);
		write('docs/issues/issues.md', '# Задачи\n\n## Сайт\n\n' + card('С1') + '\n' + card('С2'));
	});

	it('переносит задачу в другую группу', () => {
		expect(moveTask(root, 'С1', 'backlog')).toBeNull();
		expect(read('docs/issues/backlog.md')).toBe('# Бэклог\n\n## Сайт\n\n' + card('С1'));
		expect(read('docs/issues/issues.md')).not.toContain('С1');
		expect(moveTask(root, 'С1', 'нет-такой')).toBe('Нет группы нет-такой');
		expect(moveTask(root, 'Х9', 'backlog')).toBe('Нет открытой задачи Х9');
	});

	it('переносит только в файл группы', () => {
		write('docs/issues/CLAUDE.md', '# Старые правила\n');
		write('docs/x.md', '# Вне групп\n');
		expect(moveTask(root, 'С1', 'CLAUDE')).toBe('Нет группы CLAUDE');
		expect(moveTask(root, 'С1', '../x')).toBe('Нет группы ../x');
		expect(read('docs/issues/issues.md')).toContain('С1');
	});

	it('закрывает задачу с отметкой из worktree и снимает её там', () => {
		const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-wt-'));
		try {
			const mark = (id: string, status: string, url: string | null, at: string) => ({ id, status, branch: 'b', url, at });
			write('docs/issues/status.json', JSON.stringify([mark('С1', 'work', null, '2026-11-19T10:00'), mark('С2', 'work', null, '2026-11-19T09:00')]));
			fs.mkdirSync(path.join(wt, 'docs/issues'), { recursive: true });
			fs.writeFileSync(path.join(wt, 'docs/issues/status.json'), JSON.stringify([mark('С2', 'pr', 'https://github.com/x/y/pull/8', '2026-11-19T11:00')]));
			expect(closeTask(root, 'С2', [{ path: wt, branch: 'b' }])).toBeNull();
			expect(read('docs/resolved/issues-DONE.md')).toContain('PR https://github.com/x/y/pull/8');
			expect(fs.existsSync(path.join(wt, 'docs/issues/status.json'))).toBe(false);
			expect(JSON.parse(read('docs/issues/status.json'))).toMatchObject([{ id: 'С1' }]);
		} finally {
			fs.rmSync(wt, { recursive: true, force: true });
		}
	});

	it('закрывает задачу с PR из отметки и снимает отметку', () => {
		syncRules(root, rules);
		execFileSync('node', [path.join(root, 'docs/issues/issues-status.mjs'), 'С2', 'pr', 'https://github.com/x/y/pull/7']);
		expect(projectBoard(root, [])[0]!.cards.find((c) => c.id === 'С2')?.status?.url).toBe('https://github.com/x/y/pull/7');
		expect(closeTask(root, 'С2', [])).toBeNull();
		expect(read('docs/resolved/issues-DONE.md')).toMatch(/^# Закрытые задачи\n\n### С2 · Задача С2\n\n\*\*Приоритет:\*\* Средняя · \*\*Риск:\*\* 0\n\*\*Сделано:\*\* \d\d\.\d\d\.\d{4}, отмечено на доске, PR https:\/\/github\.com\/x\/y\/pull\/7\n/);
		expect(fs.existsSync(path.join(root, 'docs/issues/status.json'))).toBe(false);
		expect(projectBoard(root, [])[0]!.cards.map((c) => c.id)).toEqual(['С1']);
	});
});

describe('скрипт отметок', () => {
	beforeEach(() => {
		createBaseGroups(root);
		syncRules(root, rules);
		write('docs/issues/issues.md', '# Задачи\n\n' + card('С1'));
	});
	const status = (...args: string[]) => {
		try {
			execFileSync('node', [path.join(root, 'docs/issues/issues-status.mjs'), ...args], { stdio: 'pipe' });
			return null;
		} catch (e) {
			return String((e as { stderr: Buffer }).stderr);
		}
	};

	it('ставит, меняет и снимает отметку; ветка переходит дальше', () => {
		expect(status('С1', 'work', 'feat/a')).toBeNull();
		expect(status('С1', 'review')).toBeNull();
		expect(JSON.parse(read('docs/issues/status.json'))).toMatchObject([{ id: 'С1', status: 'review', branch: 'feat/a', url: null }]);
		expect(status('С1', 'clear')).toBeNull();
		expect(fs.existsSync(path.join(root, 'docs/issues/status.json'))).toBe(false);
	});

	it('отказывает для неизвестной задачи и чужого адреса PR', () => {
		expect(status('Х1', 'work')).toMatch(/Нет открытой задачи Х1/);
		expect(status('С1', 'pr', 'javascript:alert(1)')).toMatch(/https:\/\/github\.com/);
	});
});

describe('пересечения', () => {
	it('находит повтор общего правила в CLAUDE.md и скрывает проверенный', () => {
		const rule = rules.rules.split('\n').find((l) => l.startsWith('- Находки проверок'))!;
		write('CLAUDE.md', `# Проект\n\n${rule}\n`);
		syncRules(root, rules);
		const [o] = projectOverlaps(root, rules, []);
		expect(o).toMatchObject({ file: 'CLAUDE.md', line: 3 });
		expect(projectOverlaps(root, rules, [o!.key])).toEqual([]);
	});
});
