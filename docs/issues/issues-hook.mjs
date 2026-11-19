// Хук Claude Code для доски Claude Projects. Приложение прописывает его в .claude/settings.json проекта:
// /simplify или code review (UserPromptSubmit, PreToolUse Skill|Agent) ставит на задаче сессии отметку simplify или review.
// Задача сессии — из последней отметки `issues-status.mjs <номер> <действие>` в транскрипте; после clear задачи нет.
// Ошибка хука сессии не мешает.
// Файл ставит и обновляет приложение Claude Projects из эталона _claude-projects/rules/issues-hook.mjs: не правьте его в проекте.
import fs from 'node:fs';
import { text } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import { ACTIONS, setStatus } from './issues-status.mjs';

const ACTION_OF_SKILL = {
	simplify: 'simplify',
	'code-review': 'review',
	'mattpocock-skills:code-review': 'review',
	'code-reviewer': 'review',
};

// Скилл события: команда пользователя (UserPromptSubmit), вызов скилла или агент code-reviewer (PreToolUse); иначе null.
export function skillOf(input) {
	if (input.hook_event_name === 'UserPromptSubmit') {
		return /(?:^\s*|<command-name>)\/([\w:-]+)(?=[\s<]|$)/.exec(input.prompt ?? '')?.[1] ?? null;
	}
	if (input.tool_name === 'Skill') return input.tool_input?.skill ?? null;
	if (input.tool_name === 'Agent' && input.tool_input?.subagent_type === 'code-reviewer') return 'code-reviewer';
	return null;
}

const MARK = new RegExp(String.raw`issues-status\.mjs\s+(\S+)\s+(${ACTIONS.join('|')})\b`, 'gu');

// Задача сессии по транскрипту (строки JSON): номер из последней отметки; null — отметки нет или последняя clear.
export function sessionTask(transcript) {
	let last = null;
	for (const line of transcript.split('\n')) {
		if (!line.includes('issues-status.mjs')) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const parts = Array.isArray(entry.message?.content) ? entry.message.content : [];
		for (const p of parts) {
			if (p.type !== 'tool_use' || typeof p.input?.command !== 'string') continue;
			for (const [, id, action] of p.input.command.matchAll(MARK)) last = { id, action };
		}
	}
	return last && last.action !== 'clear' ? last.id : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const input = JSON.parse(await text(process.stdin));
		const action = ACTION_OF_SKILL[skillOf(input)];
		const id = action && input.transcript_path && sessionTask(fs.readFileSync(input.transcript_path, 'utf8'));
		if (id) setStatus(id, action);
	} catch {
		// Хук не должен ломать сессию.
	}
}
