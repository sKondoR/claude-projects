// Задача из файла группы docs/issues/<группа>.md: заголовок «### <номер> · <суть>» и всё до следующего заголовка.
export interface Question {
	to: string; // «владельцу», «заказчику», «юристу» — из «**Вопрос владельцу:**»
	text: string;
	options: { text: string; recommended: boolean }[];
}

export interface Card {
	id: string;
	title: string;
	section: string | null; // раздел «## …», в котором стоит задача
	group: string; // ключ группы: имя файла без .md
	priority?: string;
	difficulty?: string;
	risk?: string;
	deps: string[];
	stage?: string;
	found?: string;
	owner: string | null; // «владельца» из «**Уточнить у владельца**»; null — пометки нет
	questions: Question[];
	questionsText: string; // вопросы и варианты в md — для копирования
	body: string;
	warnings: string[]; // ошибки формата: карточка показывается, файл не правится
}

export type MarkStatus = 'work' | 'simplify' | 'review' | 'pr';

// Отметка сессии Claude из docs/issues/status.json.
export interface Mark {
	id: string;
	status: MarkStatus;
	branch: string | null;
	url: string | null;
	at: string;
}

export interface MdFile {
	file: string; // имя файла без папки
	text: string;
}
