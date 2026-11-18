// Рабочие копии репозитория из вывода `git worktree list --porcelain -z`: поля кончаются символом \0, записи разделены пустым полем.
// С -z git отдаёт пути как есть: без -z путь с кириллицей или кавычками приходит в кавычках и с кодами символов.

export interface WorktreeRef {
	path: string;
	branch: string; // ветка; у копии без ветки (rebase, detached HEAD) — начало хеша коммита
}

export function parseWorktrees(stdout: string): WorktreeRef[] {
	const out: WorktreeRef[] = [];
	for (const entry of stdout.split('\0\0')) {
		const fields = entry.split('\0');
		const value = (key: string) => fields.find((f) => f.startsWith(`${key} `))?.slice(key.length + 1);
		const dir = value('worktree');
		// У голого репозитория нет HEAD, у удалённой копии (prunable) нет папки: обе не нужны доске.
		const branch = value('branch')?.replace(/^refs\/heads\//, '') ?? value('HEAD')?.slice(0, 7);
		if (dir && branch && value('prunable') === undefined) out.push({ path: dir, branch });
	}
	return out;
}
