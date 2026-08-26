# Архитектура Gildra DSH

Gildra DSH состоит из трёх слоёв. Каждый слой имеет один источник данных и не
берёт на себя ответственность соседнего слоя.

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
Gildra Remote Harness (Linux, опционально)
        │
        ├── отдельный Unix-пользователь и DSH_HOME
        ├── SSH loopback tunnel, без публичного web-порта
        ├── локальный Ollama/RAG и Docker
        └── рабочие Git worktree на сервере
        │
        ▼
Gildra Harness Overlay (plugins/gildra-dsh-ui-compact)
        │
        ├── русский интерфейс
        ├── агенты, пресеты и модель ревью
        ├── компактный Context Doctor
        ├── GitHub, Archify, CodeGraph и файлы проекта
        └── плагины и автоматизации
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
