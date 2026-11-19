import { describe, expect, it } from 'vitest';
import { isOwnPrePush, prePushText, settingsWithHooks } from './hooks';

const entries = (text: string, event: string) =>
	JSON.parse(text).hooks[event].map((g: { matcher?: string; hooks: { command: string; async?: boolean }[] }) => [g.matcher ?? '', g.hooks[0]!.async ?? false]);

describe('settingsWithHooks', () => {
	it('нет файла — файл с двумя записями хука', () => {
		const text = settingsWithHooks(null);
		expect(entries(text, 'UserPromptSubmit')).toEqual([['', true]]);
		expect(entries(text, 'PreToolUse')).toEqual([['Skill|Agent', true]]);
		expect(text).toContain('node \\"$CLAUDE_PROJECT_DIR/docs/issues/issues-hook.mjs\\"');
	});

	it('свои настройки и хуки проекта остаются; повторный вызов файл не меняет', () => {
		const own = { permissions: { allow: ['Bash(pnpm test)'] }, hooks: { PreToolUse: [{ matcher: 'Skill|Agent', hooks: [{ type: 'command', command: 'node scripts/own.mjs' }] }] } };
		const text = settingsWithHooks(JSON.stringify(own, null, '\t'));
		const parsed = JSON.parse(text);
		expect(parsed.permissions).toEqual(own.permissions);
		expect(parsed.hooks.PreToolUse[0]).toEqual(own.hooks.PreToolUse[0]);
		expect(parsed.hooks.PreToolUse).toHaveLength(2);
		expect(settingsWithHooks(text)).toBe(text);
	});

	it('переводы строк файла сохраняются', () => {
		expect(settingsWithHooks('{\r\n  "model": "opus"\r\n}\r\n')).toMatch(/^\{\r\n  "model": "opus",\r\n  "hooks"/);
	});

	it('сломанный JSON или не объект — ошибка', () => {
		expect(() => settingsWithHooks('{')).toThrow();
		expect(() => settingsWithHooks('[]')).toThrow('не объект');
	});
});

describe('prePushText', () => {
	it('путь со слэшами и экранированными $ ` "; свой хук узнаётся по метке', () => {
		const text = prePushText('C:\\Users\\a$b\\proj\\docs\\issues\\issues-pre-push.mjs');
		expect(text).toMatch(/^#!\/bin\/sh\n/);
		expect(text).toContain('script="C:/Users/a\\$b/proj/docs/issues/issues-pre-push.mjs"\n[ -f "$script" ] || exit 0\n');
		expect(text).toContain('exec node "$script" "$@"\n');
		expect(isOwnPrePush(text)).toBe(true);
		expect(isOwnPrePush('#!/bin/sh\nexit 0\n')).toBe(false);
	});
});
