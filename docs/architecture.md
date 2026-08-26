# Архитектура Gildra DSH

Gildra DSH состоит из четырёх слоёв. Каждый слой имеет один источник данных и
не берёт на себя ответственность соседнего слоя.

```text
Gildra Kit Manifest (config/kit.json)
        │
        ├── версии Harness, Node, pnpm, Ollama, CodeGraph и плагинов
        ├── управляемые пресеты, Skills, MCP и автоматизации
        ├── контракт Desktop Host RPC
        └── список возможностей Overlay
        │
        ▼
Gildra Desktop Host (desktop/macos)
        │
        ├── lifecycle и восстановление процесса Harness
        ├── WebKit, загрузки и внешние ссылки
        ├── системные файловые диалоги
        ├── статус и перезапуск процесса
        └── безопасный Host RPC с белым списком методов
        │
        ▼
Gildra Runtime (plugins/gildra-dsh-runtime, локально и на сервере)
        │
        ├── Project Registry: канонические Git-репозитории
        ├── Session Manager: жизненный цикл write/read-сессий
        ├── Workspace Manager: Git worktree на каждую write-сессию
        ├── Lease Manager: эксклюзивное право записи в workspace
        ├── Process Manager: процессы, привязанные к сессии
        ├── Port Allocator: порты dev-серверов без конфликтов
        ├── Merge workflow: объединение изменений только через Git
        └── версионированный API /gildra/v1/* (loopback)
        │
        ▼
Gildra Remote Harness (Linux, опционально)
        │
        ├── отдельный Unix-пользователь и DSH_HOME
        ├── SSH loopback tunnel, без публичного web-порта
        ├── локальный Ollama/RAG и Docker
        └── тот же Gildra Runtime поверх серверных worktree
        │
        ▼
Gildra Harness Overlay (plugins/gildra-dsh-ui-compact)
        │
        ├── русский интерфейс
        ├── агенты, пресеты и модель ревью
        ├── идентификация Project/Workspace/Branch/Mode
        ├── панель Workspaces (список, lease, merge, безопасное удаление)
        └── плагины и автоматизации
```

## 0. Словарь предметной области

Термины ниже не взаимозаменяемы; документация и код используют их строго:

| Термин | Значение |
| --- | --- |
| **Environment** | Физический хост исполнения: этот компьютер или SSH-сервер |
| **Project** | Git-репозиторий/продукт, зарегистрированный в Project Registry |
| **User** | Человек; на сервере — отдельный Unix-пользователь |
| **Session** | Один рабочий контекст ИИ/пользователя (write или read) |
| **Workspace** | Файловая система сессии: отдельный Git worktree + ветка |
| **Lease** | Эксклюзивное право записи в один workspace (максимум один writer) |
| **Agent** | ИИ-исполнитель внутри сессии (writer или read-only) |
| **Task** | Логическая единица работы, связывающая сессии/агентов/воркспейсы |

## 0а. Инварианты изоляции

1. **Одна mutable-директория — не более одной write-сессии.** Каждая
   write-сессия получает собственный worktree
   `<workspacesRoot>/<project>/<user>/<session>` и ветку
   `session/<user>/<session-id>`; `git checkout` другой ветки в чужой рабочей
   папке запрещён.
2. **Запись в workspace возможна только при активном lease** с owner-token;
   чужой lease нельзя ни забрать (пока владелец жив), ни удалить.
3. **Защищённые ветки** (`main`, `master`, `production`, `release/*`,
   конфигурируемо per-project) недоступны для прямой записи AI-сессий;
   объединение — только через merge workflow: tests → review → явное
   действие merge.
4. **Пути workspace строит только сервер** из валидированных
   `projectId/userId/sessionId`; произвольные пути от UI не принимаются.
5. **Изоляция пользователей = Unix-права.** Credentials, DSH_HOME, RAG,
   state и workspaces живут в домашнем каталоге пользователя (0700/0600);
   ничего пользовательского в общих директориях проекта.
6. **Процессы принадлежат сессии.** Cleanup завершает только процессы,
   зарегистрированные за этой сессией (по PID/process group), никогда — по
   substring-поиску пути.
7. **Слияние изменений — только через Git** (merge/rebase/cherry-pick в
   merge-workspace); копирование файлов между worktree запрещено.
8. **Ничего не удаляется автоматически**, если есть активный lease,
   незакоммиченные изменения или живые процессы; восстановление после сбоя
   помечает сессии `ORPHANED` и ждёт решения пользователя.

## 0б. Основной workflow

```text
Task → Plan → Isolated Workspace (worktree + branch + lease)
     → Agents (1 writer + N read-only, либо parallel writers в отдельных worktree)
     → Changes → Tests → Review → Merge (controlled) → Cleanup
```

## 1. Gildra Kit Manifest

`config/kit.json` — единственный источник состава поставляемого продукта.
Установщики не должны содержать собственные списки версий, плагинов или
пресетов. `scripts/kit-config.mjs` проверяет ссылки между разделами manifest и
отклоняет неизвестный managed-плагин, повторяющийся preset или RPC-метод.

- `runtime` фиксирует внешние runtime-зависимости;
- `plugins` фиксирует устанавливаемые пакеты и ревизии;
- `product` связывает пресеты, Skills, MCP и автоматизации с managed-плагинами;
- `desktopHost` версионирует платформы, поверхности и RPC;
- `overlay` перечисляет функции, которые принадлежат интерфейсному слою.

Изменение состава начинается с manifest. После него обновляется lock-файл и
запускается `scripts/verify.sh`.

## 2. Gildra Desktop Host

Desktop Host владеет только возможностями операционной системы и процессом
Harness. Он не переводит HTML, не управляет пресетами и не реализует агента.

На macOS host состоит из:

- `HarnessService.swift` — запуск, остановка и восстановление Harness;
- `HarnessWebView.swift` — WebKit, загрузки и системные JavaScript-диалоги;
- `Host/HostCapabilities.swift` — типизированный контракт возможностей;
- `Host/HostRPCBridge.swift` — проверка origin и белый список RPC.

RPC доступен только главному frame с loopback-origin. Произвольное выполнение
команд через RPC намеренно отсутствует. Модельные shell-вызовы остаются в
permission layer Harness, а `dsh-plugin-terminal` предоставляет только
пользовательскую интерактивную PTY-панель и не расширяет Host RPC. Нативный host
предоставляет только:

- открытие проверенной внешней ссылки;
- выбор папки и показ существующего файла в Finder;
- чтение статуса и подтверждённый перезапуск Harness;
- чтение декларации возможностей host.

Windows пока использует Edge WebView и запускающий PowerShell-host. Поэтому
overlay обязан работать без `window.gildraHost`; новые native-only действия
должны иметь web fallback или быть явно недоступны.

Linux-сервер не является Desktop Host. На нём запускается тот же Harness и
тот же managed web-профиль, а локальное приложение подключается через
`dsh-plugin-ssh`. Серверный процесс слушает только `127.0.0.1`; системные
диалоги и открытие браузера остаются на клиентском компьютере. Ollama также
слушает только loopback, запускается отдельной пользовательской systemd-службой
и хранит embeddings-модель и RAG-индекс внутри домашнего каталога комплекта.
Управляемый launcher помечает эту среду как серверную, выбирает
`workspace-write` и закрывает неаутентифицированные маршруты предпросмотра
файлов. Явный opt-in preview допустим только для изолированного
однопользовательского сервера.

## 2а. Gildra Runtime

Серверная доменная логика мультисессионной работы живёт в отдельном
управляемом плагине `plugins/gildra-dsh-runtime` (`@gildra/dsh-runtime`).
Он загружается в процесс Harness так же, как остальные bundle-плагины, и
слушает только loopback через `ctx.webServer`.

Границы:

- **Overlay не содержит orchestration-логики**: он отображает состояние,
  вызывает API и передаёт intents. Как создать worktree, разрешить stale
  lease, выделить порт или выполнить merge — решает только Runtime.
- Runtime использует только `node:`-модули (инвариант локальных плагинов).
- Состояние — durable JSON в `<installRoot>/state/` (или
  `GILDRA_DSH_STATE_DIR`): атомарные записи, `schemaVersion`, mkdir-локи,
  повреждённый файл откладывается в сторону, а не роняет процесс.
- Опасные операции пишутся в локальный audit-лог JSONL без секретов.

Доменные модули (`lib/`): `errors` (структурированные коды: WORKSPACE_LOCKED,
PROTECTED_BRANCH, PORT_UNAVAILABLE, …), `ids` (валидация и генерация
идентификаторов, санитизация веток), `store` (durable state), `audit`,
`gitx` (bare/canonical репозитории, worktree, fetch-lock, merge),
`projects`, `leases`, `workspaces`, `sessions`, `processes`, `ports`,
`tasks`, `api` (маршруты `/gildra/v1/*`).

Раскладка на диске (per Unix-user):

```text
<installRoot>/
  state/            метаданные Runtime (sessions, leases, ports, tasks)
  repos/            канонические bare-репозитории проектов
  workspaces/
    <project>/<user>/<session-id>/   worktree одной write-сессии
```

API версионирован (`/gildra/v1/...`), ошибки — структурированные:

```json
{ "ok": false, "error": { "code": "WORKSPACE_LOCKED", "message": "…", "details": {} } }
```

Мутационные вызовы требуют owner-token сессии; произвольные shell-команды
через API не выполняются.

## 3. Gildra Harness Overlay

Overlay расширяет Harness, но не заменяет его runtime. Клиент регистрирует
именованные feature-группы, совпадающие с `overlay.features` в manifest:

- `locale`;
- `agents`;
- `context-doctor`;
- `developer-tools`;
- `plugins`;
- `automations`.

Новая функция добавляется в одну feature-группу. Если требуется доступ к ОС,
сначала расширяется версионированный Host RPC, затем добавляется безопасный
fallback для web/Windows. Прямая передача shell-команды, credentials или
непроверенного URL из Overlay в host запрещена.

## Правила совместимости

1. Изменение RPC требует увеличения `desktopHost.rpc.version`, если ломается
   существующий запрос или ответ.
2. Overlay всегда должен загружаться, когда native RPC отсутствует.
3. Managed presets принадлежат manifest и могут обновляться. Пользовательские
   preset ID вне `product.presets.managedIds` сохраняются.
4. User home, авторизации, сессии, Skills и сторонние плагины не входят в
   релизный архив и не перезаписываются обновлением.
5. Новая версия Harness сначала проверяется отдельным compatibility PR.
6. Сторонние developer tools закрепляются точными версиями. Credentials,
   browser login state, webhook URL и Context7 API key остаются только в user
   home и не входят в Kit Manifest или релизный архив.

## Проверки границ

`scripts/verify.sh` проверяет:

- schema и перекрёстные ссылки manifest;
- соответствие managed presets и Overlay features;
- соответствие RPC manifest и Swift-реализации;
- lock-файл и собранный профиль;
- JavaScript-плагины;
- сборку и подпись macOS desktop host.
