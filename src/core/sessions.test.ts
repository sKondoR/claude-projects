import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSession, sessionsIn, type Session } from './sessions';

const at = (cwd: string, pid = 1): Session => ({ pid, name: `s${pid}`, cwd: path.resolve(cwd), status: 'busy' });

describe('parseSession', () => {
	it('поля сессии; лишние поля не мешают', () => {
		const text = JSON.stringify({ pid: 20888, sessionId: 'x', cwd: 'C:\\p\\proj', name: 'proj-f0', status: 'busy', kind: 'interactive' });
		expect(parseSession(text)).toEqual({ pid: 20888, name: 'proj-f0', cwd: 'C:\\p\\proj', status: 'busy' });
	});
	it('без имени и статуса — номер процесса и пустой статус', () => {
		expect(parseSession('{"pid":7,"cwd":"C:\\\\p"}')).toEqual({ pid: 7, name: '7', cwd: 'C:\\p', status: '' });
	});
	it('не JSON или нет pid и cwd — пропуск', () => {
		expect(parseSession('{')).toBeNull();
		expect(parseSession('{"cwd":"C:\\\\p"}')).toBeNull();
		expect(parseSession('{"pid":7}')).toBeNull();
		expect(parseSession('null')).toBeNull();
	});
});

describe('sessionsIn', () => {
	const root = path.resolve('/p/proj');
	it('папка проекта, вложенная папка и worktree; регистр пути не важен', () => {
		const list = [at('/p/proj', 1), at('/P/PROJ/src', 2), at('/wt/feat', 3)];
		expect(sessionsIn([root, path.resolve('/wt/feat')], list).map((s) => s.pid)).toEqual([1, 2, 3]);
	});
	it('соседняя папка с тем же началом имени и папка выше — не проект', () => {
		expect(sessionsIn([root], [at('/p/proj2'), at('/p'), at('/p/..proj')])).toEqual([]);
	});
});
