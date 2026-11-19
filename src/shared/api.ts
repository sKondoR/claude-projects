// Обмен между основным процессом и окном: состояние приложения и действия окна.
import type { BoardGroup } from '../core/board';
import type { Overlap } from '../core/overlap';
import type { Session } from '../core/sessions';
import type { DayRow } from '../core/timelog';
import type { WorktreeRef } from '../core/worktrees';

export interface ProjectView {
	path: string;
	name: string;
	groups: BoardGroup[];
	overlaps: Overlap[]; // ещё не отмеченные «Проверено»
	notices: string[]; // ошибки чтения и синхронизации правил
	merged: WorktreeRef[]; // worktree, чей PR влит, а коммиты все вошли в PR: папку можно удалить или перевести на main
	sessions: Session[]; // запущенные сессии Claude Code в проекте и его worktree
}

export interface AppState {
	projects: ProjectView[];
	active: string | null;
	rulesDir: string;
}

export interface Api {
	state(): Promise<AppState>;
	addProject(): Promise<void>;
	removeProject(path: string): Promise<void>;
	setActive(path: string): Promise<void>;
	move(path: string, id: string, toGroup: string): Promise<string | null>; // текст ошибки или null
	close(path: string, id: string): Promise<string | null>;
	reviewed(path: string, key: string): Promise<void>;
	// Ссылка из карточки или файл проекта: http(s) — в браузере, путь от папки from внутри проекта — в программе Windows.
	open(path: string, href: string, from: string): Promise<void>;
	chooseRulesDir(): Promise<void>;
	openRules(): Promise<void>; // файл общих правил в папке эталона — в программе Windows
	setTheme(dark: boolean): Promise<void>;
	copy(text: string): Promise<void>;
	launch(path: string, id: string): Promise<string | null>; // вкладка Windows Terminal с claude по задаче; текст ошибки или null
	toMain(path: string, worktree: string): Promise<string | null>; // влитой worktree — на свежий main origin без ветки; текст ошибки или null
	timeLog(path: string): Promise<DayRow[]>; // время Claude Code в проекте и его worktree по дням, новые сверху
	onState(cb: (state: AppState) => void): () => void;
}
