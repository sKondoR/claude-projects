// Ссылка из карточки: адрес http(s) открывает браузер, путь от папки from внутри проекта — программа Windows.
import path from 'node:path';

export type Link = { url: string } | { file: string };

// null — ссылка ведёт за пределы проекта или в другую схему (file:, javascript:, диск C:).
export function resolveLink(root: string, from: string, href: string): Link | null {
	if (/^https?:\/\//i.test(href)) return { url: href };
	if (/^[a-z]+:/i.test(href)) return null;
	let rel = href.split('#')[0]!;
	try {
		rel = decodeURIComponent(rel);
	} catch {
		// Неверная %-последовательность: имя файла берётся как написано.
	}
	const file = path.resolve(root, from, rel);
	const inside = path.relative(root, file);
	return inside && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside) ? { file } : null;
}

// Файлы, которые Windows откроет программой просмотра, а не запустит. Остальные (.bat, .exe, .js, …) показываются в Проводнике.
const VIEWABLE = new Set(['.md', '.txt', '.log', '.json', '.yml', '.yaml', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
export const isViewable = (file: string) => VIEWABLE.has(path.extname(file).toLowerCase());
