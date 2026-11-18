import { describe, expect, it } from 'vitest';
import { inline, markdown } from './markdown';

describe('markdown', () => {
	it('экранирует HTML, код не размечает', () => {
		expect(inline('<b> & `**x**` **жирный**')).toBe('&lt;b&gt; &amp; <code>**x**</code> <strong>жирный</strong>');
	});

	it('ссылки и кавычки в адресе', () => {
		expect(inline('[файл](../a.md#x) [x]("y)')).toBe('<a href="../a.md#x">файл</a> <a href="&quot;y">x</a>');
	});

	it('абзацы и вложенные списки', () => {
		expect(markdown('Первый\nабзац.\n\n- а\n  - б\n- в\n\n1. один')).toBe(
			'<p>Первый абзац.</p><ul><li>а<ul><li>б</li></ul></li><li>в</li></ul><ol><li>один</li></ol>',
		);
	});

	it('вложенный список с отступом 4 пробела', () => {
		expect(markdown('- а\n    - б\n    - в\n- г')).toBe('<ul><li>а<ul><li>б</li><li>в</li></ul></li><li>г</li></ul>');
	});

	it('закрывает все уровни при возврате через несколько уровней', () => {
		expect(markdown('- а\n  - б\n    - в\n- г')).toBe('<ul><li>а<ul><li>б<ul><li>в</li></ul></li></ul></li><li>г</li></ul>');
	});
});
