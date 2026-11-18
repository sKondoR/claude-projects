// Настройки приложения в %APPDATA%\Claude Projects\settings.json: проекты, папка эталона правил, проверенные пересечения.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeAtomic } from './files';

export interface Settings {
	projects: string[];
	active: string | null;
	rulesDir: string;
	reviewed: Record<string, string[]>; // проект → ключи пар «Проверено»
	autostart: boolean; // автозапуск уже включали: пользователь мог выключить его в Windows
	theme?: 'light' | 'dark'; // нет — тема как в Windows, пока пользователь не выбрал её в меню
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings(defaultRulesDir: string): Settings {
	const base: Settings = { projects: [], active: null, rulesDir: defaultRulesDir, reviewed: {}, autostart: false };
	try {
		return { ...base, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
	} catch {
		return base;
	}
}

export const saveSettings = (s: Settings) => writeAtomic(file(), JSON.stringify(s, null, '\t') + '\n');
