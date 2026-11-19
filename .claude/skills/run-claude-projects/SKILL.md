---
name: run-claude-projects
description: Build, run and drive the Claude Projects desktop app (Electron + Svelte). Use when asked to run, start or launch the app, take a screenshot of its window, check a UI change (theme, menu, tabs, cards, legend), click through it, or run its tests. Запустить приложение, сделать скриншот окна, проверить изменение интерфейса.
---

Claude Projects — Electron-приложение для Windows. Агент управляет им через `.claude/skills/run-claude-projects/driver.mjs`: драйвер запускает собранное приложение через Playwright, выполняет команды из аргументов по порядку и закрывает окно. Настройки и проекты драйвер создаёт во временной папке: установленное приложение, его `settings.json` и настоящие проекты он не трогает.

Пути ниже — от корня репозитория. Проверено на Windows 11 (Git Bash), Node 24, pnpm 12, Electron 45, playwright-core 1.48.2.

## Setup

```bash
pnpm install
```

`playwright-core` уже в `devDependencies`. Браузеры Playwright не нужны: драйвер запускает Electron из `node_modules/electron`.

## Build

Драйвер запускает сборку из `out/`, а не dev-сервер. После каждой правки кода пересоберите, иначе скриншот покажет старый код:

```bash
pnpm build
```

## Run (agent path)

```bash
pnpm build
SHOTS_DIR=/c/tmp/shots node .claude/skills/run-claude-projects/driver.mjs "ss light" "click .menu-btn" "ss menu" "theme dark" "click .tab .warn" "click .card .head" "ss dark"
```

Каждый аргумент — одна команда. Драйвер печатает `ready: …` после загрузки доски и `> команда` перед каждой командой. Скриншоты — в `SHOTS_DIR` (по умолчанию `%TEMP%\claude-projects-shots`). Посмотрите скриншот: пустое окно — сбой запуска.

| команда | что делает |
|---|---|
| `ss <имя> [x y w h]` | скриншот окна или области → `<SHOTS_DIR>/<имя>.png` |
| `click <селектор>` | клик (Playwright: `.menu-btn`, `#app-menu button:has-text("Тёмная")`) |
| `hover <селектор>` | наведение |
| `eval <js>` | выражение в окне, результат как JSON |
| `theme light\|dark` | тема через меню, как у пользователя |
| `wait <мс>` | пауза |

Что видно сразу после запуска: проект `demo` с шестью задачами (риск 0, 1, 2, приоритеты, этап, зависимости С2 → С3 → С4, вопрос владельцу в С5, от неё зависит С6), второй пустой проект `demo2`, ⚠ на вкладке `demo` — `CLAUDE.md` примера повторяет общее правило. `click .tab .warn` открывает панель пересечений, `click .card .head` раскрывает первую карточку. `click .icon-btn[aria-label="Граф зависимостей"]` включает граф: шаги С1, С2 → С3 → С4, задачи С5 и С6 скрыты. `click .icon-btn[aria-label*="Время"]` открывает панель учёта времени: у `demo` вчера задача С2, сегодня сессия «Падение сборки» без задачи. Транскрипты примера драйвер пишет в свою папку настроек Claude (`CLAUDE_CONFIG_DIR`), поэтому круг сессий на вкладках всегда серый. Эталон правил — `rules/` этого репозитория.

Полезные селекторы: `.tabs`, `.tab.active`, `.menu-btn`, `#app-menu`, `.icon-btn`, `.timelog`, `.legend .keys .chip`, `.overlaps`, `.board .col`, `.graph .level`, `.graph .edges path`, `.card`, `.card .head`.

## Direct invocation

Большинство правок — в `src/core` (разбор задач, перенос, правила, пересечения). Их проверяют тесты, окно не нужно:

```bash
pnpm test
pnpm vitest run src/core/overlap.test.ts
pnpm check
```

`pnpm test` — 65 тестов, около 10 с: тест worktree запускает git семь раз.

## Run (human path)

```bash
pnpm dev   # окно с горячей перезагрузкой; работает с вашими настоящими настройками и проектами
```

## Gotchas

- **Playwright подменяет `prefers-color-scheme` на light.** Тема окна зависит от `nativeTheme.themeSource`, а Playwright по умолчанию эмулирует светлую схему: тёмная тема на скриншоте не появится, хотя в настройках `"theme": "dark"`. Драйвер сразу вызывает `page.emulateMedia({ colorScheme: null })`.
- **Не открывайте драйвером настоящий проект и этот репозиторий.** При открытии проекта приложение пишет в него `CLAUDE-ISSUES.md`, блок в `CLAUDE.md`, `docs/issues/*.md` и `issues-status.mjs`. Поэтому драйвер создаёт проект-пример во временной папке.
- **Установленное приложение может работать в это же время.** Блокировка одного экземпляра привязана к папке настроек: драйвер передаёт `--user-data-dir` со своей папкой, и обе копии работают.
- **Кнопка меню переключает popover.** `click .menu-btn` при открытом меню его закрывает. Команда `theme` проверяет `:popover-open` и открывает меню, только если оно закрыто.
- **Подсказки `title` не попадают на скриншот** — это окна Windows. Читайте их через `eval`, например `eval [...document.querySelectorAll('.legend .keys .chip')].map(e => e.title)`.
- **Предупреждение `DEP0190 … shell option true`** печатает Playwright на Windows. Оно не мешает.

## Troubleshooting

- **`page.click: Timeout 5000ms exceeded … element is not visible`** на кнопке внутри `#app-menu`: меню закрылось — его открыли кликом, а потом кликнули по `.menu-btn` ещё раз. Уберите лишний `click .menu-btn` или используйте `theme`.
- **Скриншот не показывает правку**: не пересобрали — `pnpm build`.
