import fs from 'node:fs';
import path from 'node:path';

export function readText(file: string): string | null {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

// Запись через временный файл в той же папке: читатель не увидит половину файла.
export function writeAtomic(file: string, text: string) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
}

export function writeIfChanged(file: string, text: string): boolean {
	if (readText(file) === text) return false;
	writeAtomic(file, text);
	return true;
}

export function listMd(dir: string, filter: (f: string) => boolean = () => true): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.md') && filter(f))
			.sort();
	} catch {
		return [];
	}
}
