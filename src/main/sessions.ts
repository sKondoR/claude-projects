// Сессии Claude Code на этом компьютере: файлы папки sessions, только живые процессы.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSession, type Session } from '../core/sessions';
import { readText } from './files';

export const SESSIONS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'sessions');

// Сигнал 0 ничего не посылает, только проверяет процесс. EPERM — процесс есть, но прав на сигнал нет.
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export function readSessions(): Session[] {
	let files: string[];
	try {
		files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
	} catch {
		return []; // Claude Code ещё не запускали
	}
	return files.map((f) => parseSession(readText(path.join(SESSIONS_DIR, f)))).filter((s): s is Session => !!s && alive(s.pid));
}
