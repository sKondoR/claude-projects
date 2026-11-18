import { describe, expect, it } from 'vitest';
import { blockRange, claudeMdText, issuesFileText, upsertBlock } from './rules';
import { hash } from './text';

describe('upsertBlock', () => {
	it('ставит блок с хешем в начало или в конец', () => {
		const h = hash('Правило');
		expect(upsertBlock('Текст\n', 'x', 'Правило', 'top')).toBe(`<!-- x:start ${h} -->\nПравило\n<!-- x:end -->\n\nТекст\n`);
		expect(upsertBlock('Текст\n', 'x', 'Правило', 'bottom')).toBe(`Текст\n\n<!-- x:start ${h} -->\nПравило\n<!-- x:end -->\n`);
		expect(upsertBlock(null, 'x', 'Правило', 'top')).toBe(`<!-- x:start ${h} -->\nПравило\n<!-- x:end -->\n`);
	});

	it('заменяет только содержимое между маркерами', () => {
		const old = upsertBlock('До\n', 'x', 'Старое', 'bottom') + '\nПосле\n';
		expect(upsertBlock(old, 'x', 'Новое', 'bottom')).toBe(`До\n\n<!-- x:start ${hash('Новое')} -->\nНовое\n<!-- x:end -->\n\nПосле\n`);
	});

	it('не меняет текст, если блок совпадает', () => {
		const text = upsertBlock('До\n', 'x', 'Правило', 'bottom');
		expect(upsertBlock(text, 'x', 'Правило', 'bottom')).toBe(text);
	});

	it('сохраняет переводы строк Windows', () => {
		const text = upsertBlock('До\r\n', 'x', 'Старое', 'bottom').replace(/\n/g, '\r\n').replace(/\r\r/g, '\r');
		expect(upsertBlock(text, 'x', 'Новое', 'bottom')).not.toMatch(/[^\r]\n/);
	});

	it('отказывается, если нет закрывающего маркера', () => {
		expect(() => upsertBlock('<!-- x:start 1 -->\nА\n', 'x', 'Б', 'top')).toThrow(/x:end/);
	});
});

describe('файлы проекта', () => {
	it('новый CLAUDE-ISSUES.md: общие правила и раздел проекта', () => {
		const text = issuesFileText(null, 'Общее');
		expect(text.startsWith('<!-- issues-rules:start')).toBe(true);
		expect(text).toContain('\n## Правила проекта\n');
		expect(blockRange(text, 'issues-rules')).toEqual([0, 2]);
	});

	it('обновление CLAUDE-ISSUES.md не трогает раздел проекта', () => {
		const text = issuesFileText(null, 'Общее') + 'Буквы: К, С.\n';
		expect(issuesFileText(text, 'Новое общее')).toMatch(/Новое общее[\s\S]*Буквы: К, С\./);
	});

	it('CLAUDE.md получает ссылку в конце', () => {
		expect(claudeMdText('# Проект\n', '@CLAUDE-ISSUES.md')).toMatch(/^# Проект\n\n<!-- issues-pointer:start \w+ -->\n@CLAUDE-ISSUES\.md\n/);
		expect(claudeMdText(null, '@CLAUDE-ISSUES.md')).toMatch(/^<!-- issues-pointer:start/);
	});
});
