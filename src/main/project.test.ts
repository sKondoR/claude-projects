// Файловые операции проекта на временной папке: создание, синхронизация правил, доска, перенос, закрытие, отметки.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTask, createBaseGroups, dropPrMarks, listWorktrees, loadRules, moveTask, prUrls, projectBoard, projectOverlaps, removableAt, switchToMain, syncRules, wrapperOf } from './project';

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
	it('создаёт базовые группы, правила, ссылку, скрипт и хук', () => {
		write('CLAUDE.md', '# Проект\n\nКоманды.\n');
		createBaseGroups(root);
		// Временная папка не в git: pre-push ставить некуда, вкладка это показывает.
		expect(syncRules(root, rules)).toEqual([expect.stringMatching(/^pre-push: в папке проекта и её подпапках нет git-репозитория/)]);
		expect(read('docs/issues/issues.md')).toBe('# Задачи\n');
		expect(read('docs/issues/backlog.md')).toBe('# Бэклог\n');
		expect(read('CLAUDE.md')).toMatch(/^# Проект\n\nКоманды\.\n\n<!-- issues-pointer:start \w+ -->\n[\s\S]*@CLAUDE-ISSUES\.md\n@CLAUDE-ISSUES-LOCAL\.md\n<!-- issues-pointer:end -->\n$/);
		expect(read('CLAUDE-ISSUES.md')).not.toContain('## Правила проекта');
		expect(read('CLAUDE.md')).toContain('@CLAUDE-ISSUES-LOCAL.md');
		expect(read('CLAUDE-ISSUES-LOCAL.md')).toBe(rules.local);
		expect(read('docs/issues/issues-status.mjs')).toBe(rules.script);
		expect(read('docs/issues/issues-hook.mjs')).toBe(rules.hook);
		expect(read('.claude/settings.json')).toContain('issues-hook.mjs');
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

	it('CLAUDE-ISSUES-LOCAL.md создаётся, только если его нет: правила проекта не затираются', () => {
		write('CLAUDE-ISSUES-LOCAL.md', '# Правила проекта\n\nБуквы: С — сайт.\n');
		syncRules(root, rules);
		syncRules(root, { ...rules, local: 'Новый шаблон.\n' });
		expect(read('CLAUDE-ISSUES-LOCAL.md')).toBe('# Правила проекта\n\nБуквы: С — сайт.\n');
	});

	it('сломанный маркер — сообщение, файл не меняется', () => {
		write('CLAUDE.md', '<!-- issues-pointer:start 1 -->\nстарое\n');
		expect(syncRules(root, rules)).toEqual([expect.stringMatching(/^CLAUDE\.md: Нет маркера/), expect.stringMatching(/^pre-push: /)]);
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

	it('номер из закрытой задачи старого формата — предупреждение на карточке', () => {
		write('docs/resolved/issues-DONE.md', '# Закрытые задачи\n\n- [x] **С1 · Низкая · Старая задача** (найдено 2026-10-29).\n');
		expect(projectBoard(root, [])[0]!.cards.find((c) => c.id === 'С1')?.warnings).toContain('номер уже есть среди закрытых задач');
	});

	it('отметки «PR» влитого PR снимаются во всех копиях, другие остаются', () => {
		const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-wt-'));
		try {
			const [pr7, pr8] = ['https://github.com/x/y/pull/7', 'https://github.com/x/y/pull/8'];
			const mark = (id: string, status: string, url: string | null) => ({ id, status, branch: 'b', url, at: '2026-11-19T10:00' });
			write('docs/issues/status.json', JSON.stringify([mark('С1', 'pr', pr7), mark('С2', 'work', null)]));
			fs.mkdirSync(path.join(wt, 'docs/issues'), { recursive: true });
			fs.writeFileSync(path.join(wt, 'docs/issues/status.json'), JSON.stringify([mark('С2', 'pr', pr7), mark('С3', 'pr', pr8)]));
			const wts = [{ path: wt, branch: 'b' }];
			expect(prUrls(root, wts)).toEqual([pr7, pr8]);
			expect(dropPrMarks(root, wts, new Set([pr7]))).toBe(true);
			expect(JSON.parse(read('docs/issues/status.json'))).toMatchObject([{ id: 'С2', status: 'work' }]);
			expect(JSON.parse(fs.readFileSync(path.join(wt, 'docs/issues/status.json'), 'utf8'))).toMatchObject([{ id: 'С3', url: pr8 }]);
			expect(dropPrMarks(root, wts, new Set([pr7]))).toBe(false);
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

describe('worktree', () => {
	it('проект в подпапке репозитория: та же подпапка в каждой копии, копия без ветки тоже видна', async () => {
		const repo = path.join(root, 'repo');
		const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
		fs.mkdirSync(path.join(repo, 'app'), { recursive: true });
		git('init', '-q', '-b', 'main');
		git('commit', '-q', '--allow-empty', '-m', 'без app');
		git('worktree', 'add', '-q', '-b', 'old', path.join(root, 'wt0'));
		fs.writeFileSync(path.join(repo, 'app', 'a.md'), 'a');
		git('add', 'app/a.md');
		git('commit', '-q', '-m', 'app');
		git('worktree', 'add', '-q', '-b', 'feat', path.join(root, 'wt 1 Ж'));
		git('worktree', 'add', '-q', '--detach', path.join(root, 'wt2'));
		const list = await listWorktrees(path.join(repo, 'app'));
		// wt0 — ветка без папки app: её нет на доске.
		expect(list.map((w) => path.relative(root, w.path))).toEqual([path.join('wt 1 Ж', 'app'), path.join('wt2', 'app')]);
		expect(list.map((w) => w.branch)).toEqual(['feat', expect.stringMatching(/^[0-9a-f]{7}$/)]);
		expect(await listWorktrees(path.join(root, 'нет-git'))).toEqual([]);
	}, 30_000); // семь запусков git на Windows дольше 5 с по умолчанию

	it('worktree можно удалить, только если нет новых файлов и коммитов сверх PR', async () => {
		const repo = path.join(root, 'repo');
		const wt = path.join(root, 'wt');
		const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe', encoding: 'utf8' });
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		git(repo, 'commit', '-q', '--allow-empty', '-m', 'начало');
		git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
		git(wt, 'commit', '-q', '--allow-empty', '-m', 'PR');
		const prHead = git(wt, 'rev-parse', 'HEAD').trim();
		expect(await removableAt(wt, prHead)).toBe(true);
		fs.writeFileSync(path.join(wt, 'new.md'), 'не в git');
		expect(await removableAt(wt, prHead)).toBe(false);
		fs.rmSync(path.join(wt, 'new.md'));
		git(wt, 'commit', '-q', '--allow-empty', '-m', 'после слияния');
		expect(await removableAt(wt, prHead)).toBe(false);
	}, 30_000);

	it('worktree переходит на свежую основную ветку origin без своей ветки', async () => {
		const src = path.join(root, 'src');
		const origin = path.join(root, 'origin');
		const repo = path.join(root, 'repo');
		const wt = path.join(root, 'wt');
		const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe', encoding: 'utf8' });
		// Основная ветка не main, и origin/HEAD нет: ветку называет origin.
		fs.mkdirSync(src);
		git(src, 'init', '-q', '-b', 'trunk');
		git(src, 'commit', '-q', '--allow-empty', '-m', 'начало');
		git(root, 'clone', '-q', '--bare', src, origin);
		git(root, 'clone', '-q', origin, repo);
		git(repo, 'remote', 'set-head', 'origin', '-d');
		git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
		// PR влит: в origin trunk появился новый коммит, папка проекта его ещё не забрала.
		git(repo, 'commit', '-q', '--allow-empty', '-m', 'слияние PR');
		git(repo, 'push', '-q', 'origin', 'trunk');
		git(repo, 'reset', '-q', '--hard', 'HEAD~1');
		expect(await switchToMain(wt)).toBeNull();
		expect(git(wt, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'trunk'));
		expect(git(wt, 'branch', '--show-current').trim()).toBe('');
		expect(git(repo, 'branch', '--list', 'feat').trim()).toBe('feat');
		expect(await switchToMain(path.join(root, 'нет-git'))).toMatch(/нет-git/);
	}, 30_000);
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

	it('сравнивает только корневой CLAUDE.md: правила, подключённые из приложения, и прочие файлы не в счёт', () => {
		const rule = rules.rules.split('\n').find((l) => l.startsWith('- Находки проверок'))!;
		write('CLAUDE.md', '# Проект\n');
		syncRules(root, rules);
		fs.appendFileSync(path.join(root, 'CLAUDE-ISSUES.md'), `${rule}\n`);
		write('docs/issues/CLAUDE.md', `# Старые правила\n\n${rule}\n`);
		expect(projectOverlaps(root, rules, [])).toEqual([]);
	});
});

describe('папка над проектом', () => {
	const repo = (dir: string) => fs.mkdirSync(path.join(root, dir, '.git'), { recursive: true });
	const proj = () => path.join(root, 'proj');

	it('обёртка репозитория проекта и его worktree', () => {
		repo('proj');
		fs.mkdirSync(path.join(root, 'design'));
		fs.mkdirSync(path.join(root, 'proj-hdr'));
		fs.writeFileSync(path.join(root, 'proj-hdr', '.git'), 'gitdir: ../proj/.git/worktrees/hdr\n');
		expect(wrapperOf(proj(), [proj(), path.join(root, 'proj-hdr')])).toBe(path.resolve(root));
	});

	it('проект не в git, репозиторий кода в его подпапке', () => {
		repo('proj/app');
		expect(wrapperOf(proj(), [proj()])).toBe(path.resolve(root));
	});

	it('общая папка проектов — не обёртка', () => {
		repo('proj');
		repo('other');
		expect(wrapperOf(proj(), [proj()])).toBeNull();
	});

	it('папка без репозиториев — не обёртка', () => {
		fs.mkdirSync(proj());
		expect(wrapperOf(proj(), [proj()])).toBeNull();
	});

	it('корень диска и домашняя папка — не обёртки', () => {
		expect(wrapperOf(path.join(path.parse(root).root, 'proj'), [])).toBeNull();
		expect(wrapperOf(path.join(os.homedir(), 'proj'), [])).toBeNull();
	});

	it('папка в git — не обёртка', () => {
		repo('.');
		fs.mkdirSync(proj());
		expect(wrapperOf(proj(), [proj()])).toBeNull();
	});
});
