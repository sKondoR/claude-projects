// Хуки доски на временном git-репозитории: отметки simplify и review (хук Claude Code), проверка push (git pre-push).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBaseGroups, loadRules, syncRules } from './project';

const rules = loadRules(path.resolve('rules'));
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
const card = (id: string) => `### ${id} · Задача ${id}\n\n**Приоритет:** Средняя · **Риск:** 0\n\nТекст ${id}.\n`;
const commit = (message: string) => {
	fs.appendFileSync(path.join(root, 'work.txt'), `${message}\n`);
	git('add', '-A');
	git('commit', '-q', '-m', message);
};

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-hook-'));
	createBaseGroups(root);
	fs.appendFileSync(path.join(root, 'docs/issues/issues.md'), '\n' + card('С1'));
	expect(syncRules(root, rules)).toEqual([]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// Каждый push — git, sh и node: 5 с по умолчанию не хватает под нагрузкой.
describe('git pre-push', { timeout: 30_000 }, () => {
	let remote: string;
	// Репозиторий с удалённым: синхронизация ставит pre-push, первый push проходит.
	beforeEach(() => {
		remote = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-remote-'));
		execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
		git('init', '-q', '-b', 'main');
		git('config', 'user.name', 't');
		git('config', 'user.email', 't@t');
		git('remote', 'add', 'origin', remote);
		expect(syncRules(root, rules)).toEqual([]);
		commit('init');
		git('push', '-q', 'origin', 'main');
	}, 30_000);
	afterEach(() => fs.rmSync(remote, { recursive: true, force: true }));

	const push = (...args: string[]) => spawnSync('git', ['push', '-q', ...args], { cwd: root, encoding: 'utf8' });

	it('коммит называет открытую задачу — push в main отменён; после закрытия задачи проходит', () => {
		commit('С1: форма заявки');
		const res = push('origin', 'main');
		expect(res.status).not.toBe(0);
		expect(res.stderr).toContain('Push в основную ветку отменён');
		expect(res.stderr).toMatch(/С1 \(\w+\)/);
		fs.writeFileSync(path.join(root, 'docs/issues/issues.md'), '# Задачи\n');
		commit('С1: закрыта');
		expect(push('origin', 'main').status).toBe(0);
	});

	it('push можно: другая ветка, другой номер, только упоминание с --no-verify', () => {
		commit('С1: часть работы');
		expect(push('origin', 'HEAD:feat/x').status).toBe(0);
		expect(push('--no-verify', 'origin', 'main').status).toBe(0);
		commit('С10: другая задача');
		expect(push('origin', 'main').status).toBe(0);
	});

	it('нет скрипта проверки — push не блокируется', () => {
		fs.rmSync(path.join(root, 'docs/issues/issues-pre-push.mjs'));
		commit('С1: форма заявки');
		expect(push('origin', 'main').status).toBe(0);
	});

	it('номер с точкой: находится как есть, точка не значит «любой символ»', () => {
		fs.appendFileSync(path.join(root, 'docs/issues/issues.md'), '\n' + card('С1.2'));
		commit('С1x2: другое');
		expect(push('origin', 'main').status).toBe(0);
		commit('С1.2: работа');
		expect(push('origin', 'main').stderr).toMatch(/С1\.2 \(\w+\)/);
	});

	it('чужой pre-push и core.hooksPath не трогаются — сообщение на вкладке', () => {
		const hook = path.join(root, '.git/hooks/pre-push');
		expect(fs.readFileSync(hook, 'utf8')).toContain('issues-pre-push.mjs');
		fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n');
		expect(syncRules(root, rules)).toEqual([expect.stringMatching(/^pre-push: в репозитории свой хук/)]);
		expect(fs.readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
		git('config', 'core.hooksPath', '.husky');
		expect(syncRules(root, rules)).toEqual([expect.stringMatching(/^pre-push: .*core\.hooksPath \(.*\.husky\)/)]);
	});
});

describe('отметки simplify и review', () => {
	const status = () => JSON.parse(fs.readFileSync(path.join(root, 'docs/issues/status.json'), 'utf8'));
	const hook = (input: object) =>
		spawnSync('node', [path.join(root, 'docs/issues/issues-hook.mjs')], { cwd: root, input: JSON.stringify({ cwd: root, ...input }), encoding: 'utf8' }).status;
	// Транскрипт сессии: строки JSON с вызовами инструментов.
	function transcript(...commands: string[]) {
		const file = path.join(root, 'transcript.jsonl');
		const lines = commands.map((command) => JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }));
		fs.writeFileSync(file, lines.join('\n') + '\n');
		return file;
	}

	it('/simplify пользователя и агент code-reviewer ставят отметку на задачу сессии', () => {
		const t = transcript('node docs/issues/issues-status.mjs С1 work feat/x');
		expect(hook({ hook_event_name: 'UserPromptSubmit', prompt: '/simplify', transcript_path: t })).toBe(0);
		expect(status()).toEqual([expect.objectContaining({ id: 'С1', status: 'simplify' })]);
		hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'code-reviewer' }, transcript_path: t });
		expect(status()).toEqual([expect.objectContaining({ id: 'С1', status: 'review' })]);
	});

	it('номер задачи с точкой — отметка ставится', () => {
		fs.appendFileSync(path.join(root, 'docs/issues/issues.md'), '\n' + card('С1.2'));
		hook({ hook_event_name: 'UserPromptSubmit', prompt: '/simplify', transcript_path: transcript('node docs/issues/issues-status.mjs С1.2 work feat/x') });
		expect(status()).toEqual([expect.objectContaining({ id: 'С1.2', status: 'simplify' })]);
	});

	it('после clear задачи нет — отметка не ставится', () => {
		const t = transcript('node docs/issues/issues-status.mjs С1 work feat/x', 'node docs/issues/issues-status.mjs С1 clear');
		hook({ hook_event_name: 'UserPromptSubmit', prompt: '/simplify', transcript_path: t });
		expect(fs.existsSync(path.join(root, 'docs/issues/status.json'))).toBe(false);
	});
});
