import { describe, expect, it } from 'vitest';
import { blockRange, claudeMdText, issuesFileText, upsertBlock } from './rules';
import { hash, lf } from './text';

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

	it('отказывается, если блок правили руками: хеш в маркере не совпал', () => {
		const text = upsertBlock('До\n', 'x', 'Правило', 'bottom').replace('Правило', 'Правило с правкой');
		expect(() => upsertBlock(text, 'x', 'Новое', 'bottom')).toThrow(/изменён вручную/);
		// Эталон догнал правку: блок не меняется, хеш в маркере обновляется.
		expect(upsertBlock(text, 'x', 'Правило с правкой', 'bottom')).toBe(text.replace(hash('Правило'), hash('Правило с правкой')));
		expect(upsertBlock('<!-- x:start -->\nСтарое\n<!-- x:end -->\n', 'x', 'Новое', 'top')).toContain('\nНовое\n');
	});

	it('отказывается, если нет закрывающего маркера', () => {
		expect(() => upsertBlock('<!-- x:start 1 -->\nА\n', 'x', 'Б', 'top')).toThrow(/x:end/);
	});
});

describe('файлы проекта', () => {
	it('новый CLAUDE-ISSUES.md — только блок общих правил: правила проекта лежат в CLAUDE-ISSUES-LOCAL.md', () => {
		expect(issuesFileText(null, 'Общее')).toBe(`<!-- issues-rules:start ${hash('Общее')} -->\nОбщее\n<!-- issues-rules:end -->\n`);
	});

	it('прежний текст CLAUDE-ISSUES.md остаётся под блоком', () => {
		const text = issuesFileText('## Правила проекта\r\n\r\nБуквы: К, С.\r\n', 'Общее');
		expect(lf(text)).toMatch(/^<!-- issues-rules:start \w+ -->\nОбщее\n<!-- issues-rules:end -->\n\n## Правила проекта\n\nБуквы: К, С\.\n$/);
		expect(text).toContain('\r\n');
		expect(issuesFileText(text, 'Новое')).toBe(text.replace(/start \w+ -->\r\nОбщее/, `start ${hash('Новое')} -->\r\nНовое`));
	});

	it('CLAUDE.md получает ссылку в конце', () => {
		expect(claudeMdText('# Проект\n', '@CLAUDE-ISSUES.md')).toMatch(/^# Проект\n\n<!-- issues-pointer:start \w+ -->\n@CLAUDE-ISSUES\.md\n/);
		expect(claudeMdText(null, '@CLAUDE-ISSUES.md')).toMatch(/^<!-- issues-pointer:start/);
	});
});
