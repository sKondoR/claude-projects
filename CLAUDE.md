# CLAUDE.md

Claude Projects — десктопное приложение (Windows) с доской задач проектов. Оно заменяет HTML-доски `issues-board` в `_soundproof` и `_auction`.
Решения и их причины — [docs/decisions.md](docs/decisions.md).

## Что делает

- Вкладки — проекты. «+» добавляет папку проекта, «×» убирает её из приложения, файлы при этом остаются.
- При добавлении приложение создаёт недостающие группы `docs/issues/{issues,security-issues,architecture-issues,other-issues,backlog}.md`.
- Приложение держит в каждом проекте три управляемых файла из эталона [rules/](rules/):
  - блок `issues-rules` в `CLAUDE-ISSUES.md` (ниже блока — «Правила проекта», их приложение не трогает);
  - блок `issues-pointer` в `CLAUDE.md` с импортом `@CLAUDE-ISSUES.md`;
  - скрипт отметок `docs/issues/issues-status.mjs`.
- Эталон синхронизируется при запуске и при изменении файлов в папке эталона. Путь к папке хранится в настройках, по умолчанию — `rules/` этого репозитория.
- Доска следит за `docs/issues`, `docs/resolved`, `CLAUDE.md`, `CLAUDE-ISSUES.md` проекта и его git worktree.
- Перенос (перетаскивание) и «Сделано» приложение пишет в `.md` само (`src/core/edit.ts`).
- ⚠ на вкладке — абзацы общих правил, которые повторяются в тексте проекта (`src/core/overlap.ts`).
- Окно закрывается в трей. Установленное приложение включает автозапуск с Windows один раз.

## Устройство

```
src/core      чистая логика без Electron: разбор задач, перенос, закрытие, блоки правил, пересечения, markdown  ← тесты Vitest
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

Настройки приложения: `%APPDATA%\Claude Projects\settings.json`.
