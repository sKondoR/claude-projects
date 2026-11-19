// Состояние PR на GitHub через gh: OPEN, MERGED или CLOSED. Нет gh, входа или сети — null, проверка тихо пропускается.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function gh(cwd: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('gh', args, { cwd, windowsHide: true, timeout: 30_000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

// PR по адресу.
export const prState = (cwd: string, url: string) => gh(cwd, ['pr', 'view', url, '--json', 'state', '--jq', '.state']);

// Последний PR ветки в репозитории папки cwd: состояние и последний коммит PR; у ветки без PR — null.
export async function branchPr(cwd: string, branch: string): Promise<{ state: string; head: string } | null> {
	const out = await gh(cwd, ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'state,headRefOid', '--jq', '.[0] // empty | "\\(.state) \\(.headRefOid)"']);
	const [state, head] = out?.split(' ') ?? [];
	return state && head ? { state, head } : null;
}
