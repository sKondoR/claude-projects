import { describe, expect, it } from 'vitest';
import { parseWorktrees } from './worktrees';

describe('parseWorktrees', () => {
	it('ветки, копия без ветки; голый репозиторий и удалённая копия пропускаются', () => {
		const out = [
			'worktree C:/p/main\0HEAD 1111111aaaa\0branch refs/heads/main\0',
			'worktree C:/Users/Иван/wt "1"\0HEAD 2222222bbbb\0branch refs/heads/feat/a\0',
			'worktree C:/p/wt2\0HEAD 3333333cccc\0detached\0',
			'worktree C:/p/bare.git\0bare\0',
			'worktree C:/p/gone\0HEAD 4444444dddd\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0',
			'',
		].join('\0');
		expect(parseWorktrees(out)).toEqual([
			{ path: 'C:/p/main', branch: 'main' },
			{ path: 'C:/Users/Иван/wt "1"', branch: 'feat/a' },
			{ path: 'C:/p/wt2', branch: '3333333' },
		]);
	});
});
