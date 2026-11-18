// Слежение за файлами: события копятся 200 мс и вызывают один обработчик.
import fs from 'node:fs';

export interface WatchTarget {
	dir: string;
	recursive: boolean;
	accept?: (file: string) => boolean; // имя файла относительно dir
}

// Временные файлы атомарной записи (*.tmp) — не изменения: за ними следует переименование.
const isTemp = (file: string) => file.endsWith('.tmp');

export function watch(targets: WatchTarget[], onChange: () => void): () => void {
	let timer: NodeJS.Timeout | undefined;
	const fire = () => {
		clearTimeout(timer);
		timer = setTimeout(onChange, 200);
	};
	const watchers: fs.FSWatcher[] = [];
	for (const t of targets) {
		try {
			const w = fs.watch(t.dir, { recursive: t.recursive }, (_event, name) => {
				const file = name?.toString();
				if (!file || (!isTemp(file) && (!t.accept || t.accept(file)))) fire();
			});
			w.on('error', () => w.close()); // папку удалили — следить больше не за чем
			watchers.push(w);
		} catch {
			// Папки нет: проект без docs или worktree удалён.
		}
	}
	return () => {
		clearTimeout(timer);
		for (const w of watchers) w.close();
	};
}
