// Тексты внутри core — с переводами строк \n; при записи файл получает прежние переводы строк.
export const lf = (s: string) => s.replace(/\r\n/g, '\n');
export const eolOf = (s: string | null) => (s?.includes('\r\n') ? '\r\n' : '\n');
export const withEol = (s: string, eol: string) => (eol === '\n' ? s : s.replace(/\n/g, eol));

// Строки до последней непустой включительно.
export function trimBlankEnd(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && !lines[end - 1]?.trim()) end--;
	return lines.slice(0, end);
}

// FNV-1a, 32 бита: короткий отпечаток текста для маркеров и ключей.
export function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}
