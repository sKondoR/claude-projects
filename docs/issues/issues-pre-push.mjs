// Проверка git pre-push для доски Claude Projects: push в основную ветку отменяется, если сообщение отправляемого коммита
// называет задачу, а в отправляемом коммите она ещё открыта (заголовок «### <номер> · …» в docs/issues).
// Так задача закрывается до push и без PR — и когда push делает Claude, и когда человек.
// Если папка проекта не в git, а репозиторий — её подпапка, docs/issues нет в коммитах: открытые задачи берутся из файлов на диске.
// Git запускает скрипт из .git/hooks/pre-push: аргументы — имя и адрес удалённого репозитория,
// на входе строки «<локальная ссылка> <хеш> <удалённая ссылка> <хеш>». Код 1 отменяет push; обойти — git push --no-verify.
// Файл ставит и обновляет приложение Claude Projects из эталона _claude-projects/rules/issues-pre-push.mjs: не правьте его в проекте.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ZERO = /^0+$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// Ошибка git — пустой вывод: нет ссылки, нет коммита.
const tryGit = (...args) => {
	try {
		return git(...args);
	} catch {
		return '';
	}
};

// Ссылки основной ветки — из <удалённый>/HEAD; без него main или master.
function mainRefs(remote) {
	const head = tryGit('symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`).slice(remote.length + 1);
	return (head ? [head] : ['main', 'master']).map((b) => `refs/heads/${b}`);
}

const ISSUES = path.dirname(fileURLToPath(import.meta.url)); // docs/issues проекта
const HEADING = /^### (\S+) · /gm;

const idsIn = (text) => [...text.matchAll(HEADING)].map((m) => m[1]);

// Чтение номеров открытых задач: заголовки «### <номер> · …». Папка проекта в git — из коммита (docs/issues от корня
// репозитория: проект может быть подпапкой); не в git — из файлов на диске, коммит не важен.
function openIdsReader() {
	const root = path.resolve(ISSUES, '../..');
	const top = tryGit('-C', root, 'rev-parse', '--show-toplevel');
	if (!top)
		return () =>
			fs
				.readdirSync(ISSUES)
				.filter((f) => f.endsWith('.md'))
				.flatMap((f) => idsIn(fs.readFileSync(path.join(ISSUES, f), 'utf8')));
	const sub = path.relative(top, root).split(path.sep).join('/');
	const pathspec = `:(top)${sub ? `${sub}/` : ''}docs/issues`;
	// Код 1 у git grep — совпадений нет; другая ошибка не глотается: проверка не должна молча пропустить push.
	return (sha) => {
		try {
			return idsIn(git('grep', '-h', '-E', '^### [^[:space:]]+ · ', sha, '--', pathspec));
		} catch (e) {
			if (e.status === 1) return [];
			throw e;
		}
	};
}

// Новые коммиты: после коммита ветки в удалённом репозитории, если он есть локально;
// иначе (новая ветка, коммит не получен) — коммиты, которых нет ни в одной известной ветке удалённого репозитория.
function newCommits(localSha, remoteSha, remote) {
	const known = remoteSha && !ZERO.test(remoteSha) && tryGit('rev-parse', '--verify', '--quiet', `${remoteSha}^{commit}`);
	return known ? [`${remoteSha}..${localSha}`] : [localSha, '--not', `--remotes=${remote}`];
}

// Номер задачи в тексте — отдельным словом: С1 не находится в С12. Номер экранируется: в нём могут быть точка или скобки.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (message, id) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(id)}(?![\\p{L}\\p{N}])`, 'u').test(message);

// Текст отказа или null — push можно.
function check(remote, input) {
	const main = mainRefs(remote);
	let openIds;
	const found = new Map(); // номер задачи → хеши коммитов, которые его называют
	for (const line of input.split('\n')) {
		const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
		if (!localSha || ZERO.test(localSha) || !main.includes(remoteRef)) continue;
		const open = (openIds ??= openIdsReader())(localSha);
		if (!open.length) continue;
		const log = git('log', '--format=%h%x00%B%x01', ...newCommits(localSha, remoteSha, remote));
		for (const entry of log.split('\x01')) {
			const [hash, message = ''] = entry.trim().split('\0');
			for (const id of open) if (hash && mentions(message, id)) found.set(id, [...(found.get(id) ?? []), hash]);
		}
	}
	if (!found.size) return null;
	const list = [...found].map(([id, hashes]) => `${id} (${hashes.join(', ')})`).join(', ');
	return [
		`Push в основную ветку отменён: коммиты называют задачи, которые ещё открыты в docs/issues: ${list}.`,
		'Закройте задачи: кнопка «Сделано» на доске или перенос блока в docs/resolved/<группа>-DONE.md со строкой «**Сделано:** <ДД.ММ.ГГГГ>, коммит <хеш>». Закоммитьте и повторите push.',
		'Если коммит задачу не закрывает, а только упоминает, отправьте его командой git push --no-verify.',
	].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const reason = check(process.argv[2] ?? 'origin', await text(process.stdin));
		if (reason) {
			console.error(reason);
			process.exitCode = 1;
		}
	} catch (e) {
		// Сбой проверки push не блокирует, но и не молчит.
		console.error(`Проверка задач перед push не сработала, push идёт без неё: ${e.message}`);
	}
}
