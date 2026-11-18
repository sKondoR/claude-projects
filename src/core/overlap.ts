// Пересечения общих правил с текстом проекта: абзацы и пункты списков сравниваются по общим словам.
import { hash, lf } from './text';

export interface Overlap {
	key: string; // отпечаток пары текстов: «Проверено» скрывает пару, пока оба текста не меняются
	rule: string;
	ruleLine: number; // строка правила в файле эталона, с 1
	file: string;
	line: number; // с 1
	text: string;
	score: number;
}

export interface OverlapSource {
	file: string;
	text: string;
	skip?: [number, number]; // строки управляемого блока (с 0, включительно)
}

const THRESHOLD = 0.6;
const MIN_WORDS = 5;
// Грубая основа слова: первые 5 букв, чтобы «задачу» и «задачи» совпали.
const STEM = 5;

interface Unit {
	line: number;
	text: string;
	words: Set<string>;
}

function units(text: string, skip?: [number, number]): Unit[] {
	const out: Unit[] = [];
	let cur: { line: number; rows: string[] } | null = null;
	const flush = () => {
		if (cur) {
			const joined = cur.rows.join(' ').trim();
			const words = new Set((joined.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3).map((w) => w.slice(0, STEM)));
			if (words.size >= MIN_WORDS) out.push({ line: cur.line + 1, text: joined, words });
		}
		cur = null;
	};
	lf(text)
		.split('\n')
		.forEach((row, i) => {
			if (skip && i >= skip[0] && i <= skip[1]) return flush();
			if (!row.trim() || /^\s*#/.test(row)) return flush();
			if (/^\s*([-*]|\d+\.) /.test(row)) flush();
			if (!cur) cur = { line: i, rows: [] };
			cur.rows.push(row.trim());
		});
	flush();
	return out;
}

function similarity(a: Set<string>, b: Set<string>): number {
	let common = 0;
	for (const w of a) if (b.has(w)) common++;
	return common / (a.size + b.size - common);
}

export function findOverlaps(rules: string, sources: OverlapSource[]): Overlap[] {
	const ruleUnits = units(rules);
	const out: Overlap[] = [];
	for (const src of sources) {
		for (const u of units(src.text, src.skip)) {
			for (const r of ruleUnits) {
				const score = similarity(r.words, u.words);
				if (score >= THRESHOLD) out.push({ key: hash(`${r.text}\n${u.text}`), rule: r.text, ruleLine: r.line, file: src.file, line: u.line, text: u.text, score });
			}
		}
	}
	return out;
}
