// Markdown задачи в HTML: `код`, **жирный**, [ссылка](адрес), абзацы и вложенные списки. Весь текст экранируется.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function inline(s: string): string {
	const code: string[] = [];
	s = s.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${code.push(c) - 1}\u0000`);
	s = esc(s)
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
	return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(code[Number(i)]!)}</code>`);
}

// Пункт с отступом больше, чем у пункта выше, открывает вложенный список; с меньшим — закрывает уровни глубже себя.
export function markdown(md: string): string {
	let html = '';
	let para: string[] = [];
	const stack: { tag: string; indent: number }[] = [];
	const flushPara = () => {
		if (para.length) html += `<p>${inline(para.join(' '))}</p>`;
		para = [];
	};
	const closeTo = (depth: number) => {
		while (stack.length > depth) html += `</li></${stack.pop()!.tag}>`;
	};
	for (const line of md.split('\n')) {
		const item = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
		if (item) {
			flushPara();
			const indent = item[1]!.length;
			const tag = /\d/.test(item[2]!) ? 'ol' : 'ul';
			const openList = () => {
				html += `<${tag}><li>`;
				stack.push({ tag, indent });
			};
			while (stack.length && indent < stack.at(-1)!.indent) closeTo(stack.length - 1);
			const top = stack.at(-1);
			if (!top || indent > top.indent) openList();
			else if (top.tag === tag) html += '</li><li>';
			else {
				closeTo(stack.length - 1);
				openList();
			}
			html += inline(item[3]!);
		} else if (!line.trim()) {
			flushPara();
			closeTo(0);
		} else if (stack.length && /^\s/.test(line)) {
			html += ' ' + inline(line.trim());
		} else {
			closeTo(0);
			para.push(line.trim());
		}
	}
	flushPara();
	closeTo(0);
	return html;
}
