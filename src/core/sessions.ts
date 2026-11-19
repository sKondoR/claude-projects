// Запущенные сессии Claude Code: файлы <pid>.json в папке sessions настроек Claude.
// Формат не описан в документации Claude Code: поля взяты из файлов версии 2.1, незнакомый файл пропускается.
import path from 'node:path';

export interface Session {
	pid: number;
	name: string; // имя сессии; без имени — номер процесса
	cwd: string; // папка, в которой запущен claude
	status: string; // busy, idle и другие значения Claude Code; пусто — поля нет
}

export function parseSession(text: string | null): Session | null {
	if (text === null) return null;
	try {
		const s = JSON.parse(text);
		if (typeof s?.pid !== 'number' || typeof s.cwd !== 'string') return null;
		return {
			pid: s.pid,
			name: typeof s.name === 'string' ? s.name : String(s.pid),
			cwd: s.cwd,
			status: typeof s.status === 'string' ? s.status : '',
		};
	} catch {
		return null;
	}
}

// Сессии, запущенные в одной из папок или во вложенной папке. Регистр пути в Windows не важен.
export function sessionsIn(dirs: string[], sessions: Session[]): Session[] {
	const inside = (dir: string, cwd: string) => {
		const rel = path.relative(dir.toLowerCase(), cwd.toLowerCase());
		return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
	};
	return sessions.filter((s) => dirs.some((d) => inside(d, s.cwd)));
}
