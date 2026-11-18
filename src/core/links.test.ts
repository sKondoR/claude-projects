import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isViewable, resolveLink } from './links';

const root = path.resolve('/proj');

describe('resolveLink', () => {
	it('адрес http(s) — в браузер', () => {
		expect(resolveLink(root, 'docs/issues', 'https://github.com/x')).toEqual({ url: 'https://github.com/x' });
		expect(resolveLink(root, 'docs/issues', 'HTTPS://Example.com')).toEqual({ url: 'HTTPS://Example.com' });
	});

	it('путь от папки ссылки внутри проекта, без якоря', () => {
		expect(resolveLink(root, 'docs/issues', '../../src/a%20b.ts#L3')).toEqual({ file: path.join(root, 'src', 'a b.ts') });
	});

	it('неверная %-последовательность — имя как написано', () => {
		expect(resolveLink(root, '.', 'file%zz.md')).toEqual({ file: path.join(root, 'file%zz.md') });
	});

	it('за пределы проекта и другие схемы — нет', () => {
		expect(resolveLink(root, 'docs/issues', '../../../x.md')).toBeNull();
		expect(resolveLink(root, '.', 'javascript:alert(1)')).toBeNull();
		expect(resolveLink(root, '.', 'C:/Windows/notepad.exe')).toBeNull();
		expect(resolveLink(root, '.', '')).toBeNull();
	});
});

describe('isViewable', () => {
	it('документы открываются, программы и скрипты — нет', () => {
		expect(['a.md', 'b.PNG', 'c.pdf'].map(isViewable)).toEqual([true, true, true]);
		expect(['a.bat', 'b.exe', 'c.js', 'd.ps1', 'e'].map(isViewable)).toEqual([false, false, false, false, false]);
	});
});
