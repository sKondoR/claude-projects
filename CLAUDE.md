# CLAUDE.md

Claude Projects — десктопное приложение (Windows) с доской задач проектов. Оно заменяет HTML-доски `issues-board` в `_soundproof` и `_auction`.
Решения и их причины — [docs/decisions.md](docs/decisions.md).

## Что делает

- Вкладки — проекты. «+» добавляет папку проекта, «×» убирает её из приложения, файлы при этом остаются.
- При добавлении приложение создаёт недостающие группы `docs/issues/{issues,security-issues,architecture-issues,other-issues,backlog}.md`.
- Приложение держит в каждом проекте управляемые файлы из эталона [rules/](rules/):
  - блок `issues-rules` в `CLAUDE-ISSUES.md`;
  - блок `issues-pointer` в `CLAUDE.md` с импортами `@CLAUDE-ISSUES.md` и `@CLAUDE-ISSUES-LOCAL.md`;
  - скрипт отметок `docs/issues/issues-status.mjs`;
  - хук Claude Code `docs/issues/issues-hook.mjs` и его записи в `.claude/settings.json` (`src/core/hooks.ts`): отметки simplify и review;
  - проверка `docs/issues/issues-pre-push.mjs` и git-хук `.git/hooks/pre-push`, который её запускает: push в основную ветку отменяется, если коммит называет задачу, а она ещё открыта. Чужой `pre-push` и `core.hooksPath` приложение не трогает и пишет об этом на вкладке.
- Правила проекта лежат в `CLAUDE-ISSUES-LOCAL.md`. Если файла нет, приложение создаёт его из `rules/local.md` и больше не меняет.
- Эталон синхронизируется при запуске и при изменении файлов в папке эталона. Путь к папке хранится в настройках, по умолчанию — `rules/` этого репозитория.
- Доска следит за `docs/issues`, `docs/resolved`, `CLAUDE.md`, `CLAUDE-ISSUES.md` проекта и его git worktree.
- Перенос (перетаскивание) и «Сделано» приложение пишет в `.md` само (`src/core/edit.ts`).
- ⚠ на вкладке — абзацы общих правил, которые повторяются в корневом `CLAUDE.md` проекта; блок, вставленный приложением, не в счёт (`src/core/overlap.ts`). Из пары открывается и файл проекта, и `issues-rules.md` эталона.
- Круг на вкладке — запущенные сессии Claude Code в проекте и его worktree: зелёный с числом сессий, серый — сессий нет. Приложение читает `~/.claude/sessions/<pid>.json` (формат не документирован) и проверяет, что процесс жив (`src/core/sessions.ts`, `src/main/sessions.ts`).
- Меню в правом верхнем углу: тема светлая или тёмная. Тёмная — по дизайну `_soundproof` без неонового свечения. Выбор хранится в настройках; до выбора тема как в Windows (`nativeTheme`).
- Окно закрывается в трей. Установленное приложение включает автозапуск с Windows один раз.

## Устройство

```
src/core      чистая логика без Electron: разбор задач, перенос, закрытие, блоки правил, пересечения, markdown, ссылки, worktree  ← тесты Vitest
src/main      основной процесс: файлы проекта (project.ts), слежение (watch.ts), настройки, окно, трей, IPC
src/preload   window.api для окна
src/renderer  Svelte 5: вкладки, столбцы, карточки
src/shared    типы обмена между процессами
rules         эталон правил, ссылки и скрипта отметок
```

Логику с текстом файлов пиши в `src/core` и покрывай тестами. `src/main` только читает и пишет файлы.

## Команды

```
pnpm dev      запуск с горячей перезагрузкой
pnpm test     тесты core и файловых операций (временные папки)
pnpm check    svelte-check и TypeScript
pnpm dist     установщик NSIS в dist/
```

Проверить правку в окне (скриншоты, клики) — навык `/run-claude-projects`: драйвер запускает сборку с временными настройками и проектом-примером.

Настройки приложения: `%APPDATA%\Claude Projects\settings.json`.
