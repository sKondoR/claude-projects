// Хуки доски в проекте: хук Claude Code в .claude/settings.json (приложение добавляет недостающие записи, остальные настройки
// не трогает) и git pre-push, который запускает проверку docs/issues/issues-pre-push.mjs.
import { eolOf, withEol } from './text';

export const SETTINGS_FILE = '.claude/settings.json';
export const HOOK_SCRIPT = 'issues-hook.mjs'; // в эталоне и в docs/issues проекта
const COMMAND = `node "$CLAUDE_PROJECT_DIR/docs/issues/${HOOK_SCRIPT}"`;

// События хука: команда пользователя (/simplify) и вызов скилла или агента code-reviewer.
const ENTRIES = [
	{ event: 'UserPromptSubmit', matcher: '' },
	{ event: 'PreToolUse', matcher: 'Skill|Agent' },
];

interface HookGroup {
	matcher?: string;
	hooks?: { command?: string; [key: string]: unknown }[];
}

// Текст settings.json с хуком доски. Запись на месте — файл не меняется. Сломанный JSON — ошибка.
export function settingsWithHooks(old: string | null): string {
	const settings = old?.trim() ? JSON.parse(old) : {};
	if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('В файле не объект JSON');
	const hooks: Record<string, HookGroup[]> = (settings.hooks ??= {});
	let changed = !old?.trim();
	for (const e of ENTRIES) {
		const groups = (hooks[e.event] ??= []);
		if (groups.some((g) => (g.matcher ?? '') === e.matcher && g.hooks?.some((h) => h.command?.includes(HOOK_SCRIPT)))) continue;
		groups.push({
			...(e.matcher ? { matcher: e.matcher } : {}),
			// Хук только ставит отметки: работает фоном (async) и сессию не задерживает.
			hooks: [{ type: 'command', command: COMMAND, timeout: 10, async: true }],
		});
		changed = true;
	}
	return changed ? withEol(JSON.stringify(settings, null, 2) + '\n', eolOf(old)) : old!;
}

// git pre-push репозитория проекта: sh-скрипт запускает проверку docs/issues/issues-pre-push.mjs.
// Нет скрипта (проект убран, файл удалён) или нет node — push идёт без проверки, а не блокируется.
export const PRE_PUSH_SCRIPT = 'issues-pre-push.mjs';
const PRE_PUSH_MARK = 'claude-projects pre-push';
export const isOwnPrePush = (text: string) => text.includes(PRE_PUSH_MARK);

export function prePushText(script: string): string {
	const quoted = script.replace(/\\/g, '/').replace(/[$`"]/g, '\\$&');
	return [
		'#!/bin/sh',
		`# ${PRE_PUSH_MARK}: файл пишет приложение Claude Projects. Проверка задач перед push в основную ветку.`,
		`script="${quoted}"`,
		'[ -f "$script" ] || exit 0',
		'command -v node >/dev/null 2>&1 || exit 0',
		'exec node "$script" "$@"',
		'',
	].join('\n');
}
