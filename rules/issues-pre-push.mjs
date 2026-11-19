// Проверка git pre-push для доски Claude Projects: push в основную ветку отменяется, если сообщение отправляемого коммита
// называет задачу, а в отправляемом коммите она ещё открыта (заголовок «### <номер> · …» в docs/issues).
// Так задача закрывается до push и без PR — и когда push делает Claude, и когда человек.
// Git запускает скрипт из .git/hooks/pre-push: аргументы — имя и адрес удалённого репозитория,
// на входе строки «<локальная ссылка> <хеш> <удалённая ссылка> <хеш>». Код 1 отменяет push; обойти — git push --no-verify.
// Файл ставит и обновляет приложение Claude Projects из эталона _claude-projects/rules/issues-pre-push.mjs: не правьте его в проекте.
import { execFileSync } from 'node:child_process';
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

// docs/issues проекта от корня репозитория: проект может быть подпапкой.
function issuesPathspec() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
	const sub = path.relative(git('-C', root, 'rev-parse', '--show-toplevel'), root).split(path.sep).join('/');
	return `:(top)${sub ? `${sub}/` : ''}docs/issues`;
}

// Номера открытых задач в коммите: заголовки «### <номер> · …». Код 1 у git grep — совпадений нет;
// другая ошибка не глотается: проверка не должна молча пропустить push.
function openIds(sha, pathspec) {
	try {
		return [...git('grep', '-h', '-E', '^### [^[:space:]]+ · ', sha, '--', pathspec).matchAll(/^### (\S+) · /gm)].map((m) => m[1]);
	} catch (e) {
		if (e.status === 1) return [];
		throw e;
	}
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
	let pathspec;
	const found = new Map(); // номер задачи → хеши коммитов, которые его называют
	for (const line of input.split('\n')) {
		const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
		if (!localSha || ZERO.test(localSha) || !main.includes(remoteRef)) continue;
		const open = openIds(localSha, (pathspec ??= issuesPathspec()));
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
