window.__ModuleLoader__.load({
  id: '@gildra/dsh-ui-compact',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const CSS = `
      [data-context-doctor] > button {
        min-height: 27px !important;
        width: 31px !important;
        padding: 3px 6px !important;
        gap: 3px !important;
        justify-content: center !important;
        border-radius: 7px !important;
        font-size: 11px !important;
        cursor: pointer !important;
      }
      [data-context-doctor] > button > span:nth-child(2) {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
      [data-context-doctor] > button > span:last-child {
        width: 6px !important;
        height: 6px !important;
        margin-left: -2px !important;
        align-self: flex-end !important;
      }
      [data-context-doctor] > section[role="dialog"] {
        width: 320px !important;
        max-width: calc(100vw - 20px) !important;
        max-height: min(52vh, 420px) !important;
        border-radius: 10px !important;
      }
      @media (max-width: 520px) {
        [data-context-doctor] > section[role="dialog"] {
          left: 50% !important;
          right: auto !important;
          transform: translateX(-50%) !important;
          width: 290px !important;
          max-height: min(48vh, 390px) !important;
        }
      }

      body:has(.dsh-automation-shell) .dsh-automation-sidebar-feedback {
        display: none !important;
      }
      .dsh-automation-shell {
        padding-top: 18px !important;
        padding-bottom: 24px !important;
      }
      [data-conversation-scroll]:has(.dsh-automation-shell) > [data-composer-seat] {
        display: none !important;
      }
      .dsh-automation-stats {
        gap: 8px !important;
        margin-bottom: 14px !important;
      }
      .dsh-automation-stats > div {
        min-height: 58px !important;
        padding: 8px 12px !important;
      }
      .dsh-automation-stats > div:nth-child(-n+2) strong {
        font-size: 18px !important;
      }
      .gildra-automation-quickstart {
        max-width: 1440px;
        margin: 0 auto 14px;
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l2));
        border-radius: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 35%, var(--dsw-alias-bg-layer-1));
      }
      .gildra-automation-quickstart strong {
        display: block;
        margin-bottom: 2px;
        font-size: 13px;
      }
      .gildra-automation-quickstart p {
        margin: 0 0 10px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 17px;
      }
      .gildra-automation-template-list {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .gildra-automation-template-list button {
        min-height: 42px;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 9px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 600 11px/16px var(--dsw-font-family, system-ui);
        text-align: left;
        cursor: pointer;
      }
      .gildra-automation-template-list button:hover,
      .gildra-automation-template-list button:focus-visible {
        border-color: var(--dsw-alias-state-business-primary);
        color: var(--dsw-alias-state-business-primary);
        outline: none;
      }
      .dsh-automation-create {
        position: fixed !important;
        z-index: 3000 !important;
        top: 36px !important;
        bottom: 36px !important;
        left: 50% !important;
        width: min(820px, calc(100vw - 48px)) !important;
        max-width: none !important;
        margin: 0 !important;
        overflow: auto !important;
        transform: translateX(-50%) !important;
        background: var(--dsw-alias-bg-layer-1) !important;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .55) !important;
      }
      .dsh-automation-create::before {
        position: fixed;
        z-index: -1;
        inset: -100vh -100vw;
        background: rgba(4, 6, 10, .62);
        content: '';
      }
      .dsh-automation-form-footer {
        position: sticky;
        z-index: 2;
        bottom: -18px;
        padding: 13px 0 16px !important;
        background: var(--dsw-alias-bg-layer-1);
      }
      @media (max-width: 760px) {
        .gildra-automation-template-list {
          grid-template-columns: 1fr;
        }
        .dsh-automation-create {
          top: 8px !important;
          bottom: 8px !important;
          width: calc(100vw - 16px) !important;
          padding: 14px !important;
        }
      }
    `

    const BRAND_HEADLINE = 'Gildra Coding'
    const DEFAULT_HEADLINE = 'Into the Unknown'

    const AUTOMATION_TEXT = new Map([
      ['Automations', 'Автоматизации'],
      ['Open Automations', 'Открыть автоматизации'],
      ['Start a conversation before opening Automations.', 'Сначала отправьте одно сообщение в новой сессии.'],
      ['Autonomous coding work', 'Автоматизация разработки'],
      ['New automation', 'Новая автоматизация'],
      ['Close form', 'Закрыть форму'],
      ['Workspace', 'Проект'],
      ['Working folder', 'Рабочая папка'],
      ['Total', 'Всего'],
      ['Active', 'Активные'],
      ['Next run', 'Следующий запуск'],
      ['Needs attention', 'Требуют внимания'],
      ['Not scheduled', 'Не запланировано'],
      ['All clear', 'Всё в порядке'],
      ['Workspace automations', 'Автоматизации проекта'],
      ['Recent runs', 'Последние запуски'],
      ['Refresh', 'Обновить'],
      ['Schedule fresh, auditable agent runs for this workspace.', 'Запускайте проверяемые задачи ИИ по расписанию для этого проекта.'],
      ['Each trigger opens a fresh DSH session with its own audit trail.', 'Каждый запуск получает отдельную сессию и журнал действий.'],
      ['Latest execution state across this workspace.', 'Последние результаты запусков в этом проекте.'],
      ['Put recurring coding work on autopilot', 'Передайте повторяющиеся задачи ИИ'],
      ['Create a focused task with an explicit schedule and permission boundary. Every run starts in a fresh session.', 'Выберите задачу, расписание и допустимый уровень доступа. Каждый запуск выполняется в отдельной сессии.'],
      ['Create your first automation', 'Создать первую автоматизацию'],
      ['Create an automation', 'Новая автоматизация'],
      ['Edit automation', 'Редактировать автоматизацию'],
      ['Write a self-contained prompt: scheduled runs do not inherit this conversation.', 'Опишите задачу полностью: запуски по расписанию не получают историю этого чата.'],
      ['Name', 'Название'],
      ['Task prompt', 'Задача для ИИ'],
      ['Model', 'Модель'],
      ['Follow global', 'Как в основном чате'],
      ['Resolve the live global selection when each run starts.', 'Использовать модель, выбранную в основном чате на момент запуска.'],
      ['Keep this automation on the selected provider and model.', 'Всегда использовать выбранную модель для этой автоматизации.'],
      ['Reasoning effort', 'Глубина рассуждения'],
      ['Model default', 'По умолчанию модели'],
      ['Reasoning follows the global selection.', 'Глубина следует настройке основного чата.'],
      ['Options are supplied by the selected model.', 'Доступные уровни зависят от выбранной модели.'],
      ['Schedule', 'Расписание'],
      ['Once', 'Один раз'],
      ['Interval', 'Интервал'],
      ['Daily', 'Каждый день'],
      ['Weekly', 'По неделям'],
      ['Run at', 'Запустить'],
      ['Every', 'Каждые'],
      ['minutes', 'минут'],
      ['Time', 'Время'],
      ['Days', 'Дни'],
      ['Time zone', 'Часовой пояс'],
      ['Permission boundary', 'Доступ к проекту'],
      ['Read only', 'Только чтение'],
      ['Inspect the workspace without changing files.', 'Проверять проект без изменения файлов.'],
      ['Workspace write', 'Можно исправлять файлы'],
      ['May edit files inside this workspace; approval is not inherited.', 'Разрешено изменять файлы только внутри проекта; подтверждения не наследуются.'],
      ['Cancel', 'Отмена'],
      ['Create automation', 'Создать автоматизацию'],
      ['Save changes', 'Сохранить'],
      ['No runs yet. Trigger an automation now or wait for its schedule.', 'Запусков пока нет. Запустите задачу вручную или дождитесь расписания.'],
      ['Mon', 'Пн'], ['Tue', 'Вт'], ['Wed', 'Ср'], ['Thu', 'Чт'], ['Fri', 'Пт'], ['Sat', 'Сб'], ['Sun', 'Вс'],
      ['Run now', 'Запустить сейчас'],
      ['Pause', 'Пауза'],
      ['Resume', 'Продолжить'],
      ['Edit', 'Изменить'],
      ['Delete', 'Удалить'],
    ])

    const AUTOMATION_PLACEHOLDERS = new Map([
      ['Daily regression triage', 'Ежедневная проверка проекта'],
      ['Review new test failures, identify the regression, and propose the smallest verified fix…', 'Опишите, что проверить, когда исправлять автоматически и какие действия запрещены…'],
    ])

    const PLUGIN_RU_DICTIONARIES = {
      'settings.pluginBridge': {
        tab: 'Плагины агентов',
        title: 'Мост плагинов агентов',
        bridgeTabs: 'Состояние по агентам',
        bridgeOverview: 'Обзор',
        codexBridge: 'Codex',
        claudeCodeBridge: 'Claude Code',
        piBridge: 'Pi',
        loading: 'Читаем плагины и каталоги…',
        loadError: 'Мост плагинов временно недоступен.',
        retry: 'Повторить',
        mutationError: 'Операция не выполнена. Существующие плагины не изменены.',
        installErrorTimeout: 'Источник плагина отвечал слишком долго. Повторите попытку или проверьте журнал Host.',
        installErrorInstalled: 'Этот плагин уже установлен. Обновите список.',
        installErrorUnsupported: 'Установка невозможна: мост не поддерживает возможности этого плагина.',
        installErrorInvalid: 'Некорректный манифест или структура плагина. Проверьте журнал Host.',
        installErrorActivation: 'Плагин загружен, но его возможности не подключились. Проверьте журнал Host.',
        installErrorSource: 'Не удалось загрузить источник. Проверьте адрес и соединение.',
        installErrorGeneric: 'Host не смог завершить установку.',
        rescan: 'Обновить список',
        piUpdates: 'Обновления пакетов Pi',
        piUpdateMode: 'Режим обновлений',
        piUpdateModeNotify: 'Только уведомлять',
        piUpdateModeAuto: 'Обновлять автоматически',
        piUpdateModeOff: 'Не проверять',
        checkUpdates: 'Проверить сейчас',
        updateAll: 'Обновить всё',
        update: 'Обновить',
        lastChecked: 'Последняя проверка',
        piUpdatesEmpty: 'Для импортированных пакетов Pi обновлений нет.',
        autoUpdatePackage: 'Разрешить автоматическое обновление этого пакета',
        piScope_user: 'Для пользователя',
        piScope_project: 'Для проекта',
        installed: 'Установлено',
        installedEmpty: 'В DSH пока не импортировано ни одного плагина.',
        configuredMarketplaces: 'Подключённые каталоги',
        marketplaceLocation: 'Локальный путь или GitHub-адрес каталога',
        add: 'Добавить',
        configuredEmpty: 'Подключённых каталогов нет.',
        plugins: 'плагинов',
        searchPlugins: 'Поиск плагинов',
        noPluginMatches: 'Подходящих плагинов нет.',
        discoveredMarketplaces: 'Найденные регистрации каталогов',
        discoveredMarketplacesEmpty: 'Каталоги Codex или Claude Code не найдены.',
        discoveredLocal: 'Найденные локальные плагины',
        discoveredLocalEmpty: 'Локальные плагины Codex, Claude Code или Pi не найдены.',
        rows: 'модулей возможностей',
        protected: 'защищено',
        unsupported: 'не поддерживается',
        codexHostRequired: 'Плагин использует подключение App из Codex. Подключитесь и войдите в Codex, чтобы оно заработало.',
        enabled: 'Включён',
        disabled: 'Выключен',
        foreignEnabled: 'Включён в источнике',
        foreignDisabled: 'Выключен в источнике',
        enable: 'Включить',
        disable: 'Выключить',
        install: 'Установить',
        installing: 'Установка…',
        working: 'Выполняется…',
        downloading: 'Загрузка…',
        remoteMarketplaceRegistration: 'Регистрация Git · полный каталог загрузится при добавлении',
        import: 'Импортировать',
        imported: 'Импортирован',
      },
      'at-file': {
        'dock.aria': 'Упомянутые пути проекта',
        'dock.remove': 'Убрать {name}',
        nav: 'Упоминания файлов',
        'settings.title': 'Упоминания файлов проекта',
        'settings.subtitle': 'Введите @, чтобы найти путь в проекте. Плагин передаёт путь, не читая содержимое файла.',
        'settings.enabled': 'Включить упоминания файлов через @',
        'settings.enabledDesc': 'При выключении скрываются поиск путей и выбранные ссылки, а пути не передаются модели.',
        'settings.ignorePastedMentions': 'Игнорировать @ в вставленном тексте',
        'settings.ignorePastedMentionsDesc': 'Вставленные через буфер @-ссылки останутся обычным текстом.',
        'settings.ignoreFiles': 'Фильтры файлов',
        'settings.ignoreFilesDesc': 'Правила применяются только к имени файла. Можно использовать точное имя или регулярное выражение.',
        'settings.scope': 'Область фильтра',
        'settings.global': 'Глобально',
        'settings.workspace': 'Проект',
        'settings.globalTitle': 'Глобальные правила',
        'settings.globalDesc': 'Применяются ко всем проектам.',
        'settings.workspaceTitle': 'Правила проекта',
        'settings.workspaceDesc': 'Применяются только к выбранному проекту вместе с глобальными правилами.',
        'settings.workspaceSelect': 'Проект',
        'settings.noWorkspace': 'Нет доступного проекта',
        'settings.restoreDefaults': 'Восстановить стандартные',
        'settings.clearWorkspace': 'Очистить правила проекта',
        'settings.emptyGlobal': 'Глобальных фильтров нет.',
        'settings.emptyWorkspace': 'У проекта нет дополнительных фильтров.',
        'settings.namePlaceholder': 'Например, desktop.ini',
        'settings.regexPlaceholder': 'Например, \\.map$ или ^test-',
        'settings.nameHint': 'Введите полное имя файла без пути.',
        'settings.regexHint': 'Регулярное выражение проверяется по полному имени файла без пути.',
        'settings.invalidName': 'Имя файла не может содержать разделители пути.',
        'settings.invalidRegex': 'Некорректное регулярное выражение.',
        'settings.duplicateName': 'Такое имя уже есть в текущем списке.',
        'settings.inheritedName': 'Это имя уже отфильтровано глобально.',
        'settings.add': 'Добавить',
        'settings.saving': 'Сохранение',
        'settings.remove': 'Удалить {name}',
        'settings.inherited': 'Также применяются глобальные правила',
        'settings.ruleType': 'Тип правила',
        'settings.kind.exact': 'Точное имя',
        'settings.kind.regex': 'Регулярное выражение',
        'settings.caseSensitive': 'Учитывать регистр',
        'settings.caseInsensitive': 'Не учитывать регистр',
        'settings.caseSensitiveOption': 'Учитывать регистр',
      },
      'dsh-context': {
        tab: 'Контекст',
        'cat.system': 'Системный промпт',
        'cat.tools': 'Схемы инструментов',
        'cat.user': 'Сообщения пользователя',
        'cat.inject': 'Добавленный контекст',
        'cat.assistant': 'Ответы ассистента',
        'cat.tool': 'Результаты инструментов',
        'overview.title': 'Текущий контекст',
        'overview.estimate': 'токенов (оценка)',
        'overview.free': 'Свободное окно',
        'overview.used': 'контекста использовано',
        'overview.ofUsed': 'использованного контекста',
        'overview.compactReserve': 'Резерв автосжатия: оно запускается на {pct}% окна, поэтому эта область обычно остаётся свободной.',
        'stats.title': 'Статистика контекста',
        'stats.hint': 'Содержится в текущем контексте',
        'stats.turns': 'Ходы',
        'stats.steps': 'Шаги',
        'stats.injects': 'Добавления',
        'stats.compactions': 'Сжатия',
        'stats.prunes': 'Очистки',
        'stats.toolCalls': 'Вызовы инструментов',
        'stats.images': 'Изображения',
        'stats.cacheHit': 'Попадание в кэш',
        'stats.cost': 'Стоимость',
        'stats.costTip': 'Приблизительная стоимость всей сессии по тарифам DeepSeek. Значение справочное.',
        'stats.costPriceHead': 'Цена за 1 млн токенов (пик | половина цены вне пика):',
        'stats.costHit': 'кэш',
        'stats.costMiss': 'без кэша',
        'stats.costOut': 'вывод',
        'plugin.title': 'О плагине',
        'plugin.hint': 'Расширенная панель контекста DSH',
        'plugin.name': 'Плагин',
        'plugin.github': 'GitHub',
        'tools.top': 'Самые объёмные схемы:',
        'tools.more': 'из {n}',
        'trend.title': 'История контекста',
        'gran.step': 'Шаг',
        'gran.turn': 'Ход',
        'settings.title': 'Контекст',
        'settings.desc': 'Настройки отображения панели Context',
        'settings.gran': 'Детализация графика',
        'settings.mode': 'Режим графика',
        'settings.expand': 'Развернуть',
        'settings.collapse': 'Свернуть',
        'settings.readOnly': 'В этом окружении настройки доступны только для чтения',
        'gran.total': 'Всего',
        'gran.delta': 'Изменение',
        'gran.modeHint': 'Всего: накопленный состав; изменение: разница с предыдущим запросом.',
        'trend.hint': '✂ означает сжатие или очистку; Шаг/Ход меняет детализацию.',
        'trend.empty': 'После отправки сообщения здесь появится состав контекста каждого запроса.',
        'detail.step': 'Ход {t} · шаг {s}',
        'detail.turn': 'Ход {t} · шагов: {n}',
        'detail.lastStep': 'Последний шаг',
        'detail.estTotal': 'Оценка ≈ {n}',
        'detail.actual': 'Фактически во входе {n}',
        'detail.output': 'Вывод {n}',
        'detail.cache': 'Кэш {n}%',
        'events.title': 'События контекста',
        'events.empty': 'Событий пока нет: здесь появятся сжатия, добавления и смена модели.',
        'events.at': 'Ход {t} · шаг {s}',
        'events.range': 'Ход {t} · шаги {a}→{b}',
        'events.rangeTo': 'Ход {a} · шаг {as} → ход {b} · шаг {bs}',
        'kind.inject': 'Добавление',
        'kind.compaction': 'Сжатие',
        'kind.prune': 'Очистка',
        'kind.model': 'Смена модели',
        'kind.mode': 'Режим',
        'nodes.title': 'Сообщения',
        'nodes.hint': 'видимые модели сейчас, новые сверху',
        'nodes.more': '… пропущено предыдущих сообщений: {n}',
        'nodes.empty': 'Сейчас модель не видит сообщений',
        loading: 'Читаем журнал сессии…',
        error: 'Не удалось прочитать контекст: ',
        'error.retry': 'Повторить',
        footer: 'Оценка использует приближение около 4 символов на токен; фактическое значение сообщает провайдер.',
        'tip.step': 'Ход {t} · шаг {s}',
        'tip.turn': 'Ход {t} · шагов: {n}',
        'tip.total': 'Всего ≈ {n}',
        'tip.actual': ' (фактически {n})',
        'tip.delta': 'Δ {n}',
        'ev.compaction': 'Контекст сжат: сводка заменила сообщений — {n}',
        'ev.prune': 'Результат инструмента очищен',
        'ev.skill': 'Добавлен навык {name}',
        'ev.model': 'Модель изменена: {a} → {b}',
        'ev.mode.plan.on': 'Режим планирования включён',
        'ev.mode.plan.off': 'Режим планирования выключен',
        'form.instructions': 'Инструкции',
        'form.catalog': 'Обновление каталога',
        'form.snapshot': 'Снимок состояния',
        'form.notice': 'Уведомление',
        'form.relay': 'Передача агенту',
        'form.recall': 'Воспоминание',
        'form.context': 'Добавление контекста',
        'node.toolResult': 'Результат инструмента',
        'node.calls': 'Вызовы ',
        'node.empty': '(пустой ответ)',
        'node.nonText': '(нетекстовое сообщение)',
        'node.snapshot': 'Снимок: ',
        'node.skillTag': 'Навык · {name}',
        'cmd.desc': 'Показать текущий состав контекста по шагам',
        'cmd.close': 'Закрыть',
        'browser.title': 'Просмотр контекста',
        'browser.live': 'Сейчас (следующий запрос)',
        'browser.liveNow': 'Сейчас · следующий запрос',
        'browser.items': 'Элементов: {n}',
        'browser.missingLive': '… ещё {n} предыдущих сообщений входят в контекст за пределами загруженного окна.',
        'browser.approx': 'Некоторые удалённые сообщения уже не хранятся, поэтому состав приблизительный.',
        'browser.deltaHint': 'относительно предыдущего хода',
        'browser.noHeader': 'Старая версия плагина: доступны только оценки токенов.',
        'browser.noEpoch': 'Заголовок этого шага уже не хранится.',
        'browser.noContent': 'Полное содержимое вне загруженного окна. Загрузите старую историю в чате.',
        'browser.loading': 'Загружаем полное содержимое из истории…',
        'browser.preview': 'Предпросмотр',
        'tool.desc': 'Описание',
        'tool.params': 'Параметры',
        'tool.paramsEmpty': '(параметров нет)',
        'tool.jsonToggle': 'Показать исходный JSON',
        'tool.jsonHide': 'Свернуть',
        'rich.raw': 'Исходный текст',
        'rich.md': 'Markdown',
        'rich.toMd': 'Показать как Markdown',
        'rich.toRaw': 'Показать исходный текст',
        'block.thinking': 'Рассуждение',
        'block.answer': 'Ответ',
        'block.content': 'Содержимое',
        'block.result': 'Результат',
        'block.summary': 'Сводка',
        'block.line': '1 строка',
        'block.lines': 'Строк: {n}',
        'call.ok': 'Готово',
        'call.fail': 'Ошибка',
        'call.exit': 'код выхода {n}',
        'node.failed': 'Инструмент завершился с ошибкой',
        'attach.images': 'Изображения',
        'attach.other': 'Другое содержимое',
        'attach.image': 'Изображение',
        'attach.open': 'Открыть изображение',
        'attach.preview': 'Предпросмотр изображения',
        'attach.close': 'Закрыть',
        'attach.loading': '…',
        'attach.loadFailed': 'Не удалось загрузить · нажмите для повтора',
        'attach.raw': 'Оригинал',
        'attach.sent': 'Отправлено',
        'attach.token': 'Токены',
        'attach.tokensTip': 'Приблизительный расход токенов изображения.',
      },
    }

    const AGENT_SYNC_TEXT = new Map([
      ['MCP/Skills 管理', 'Управление MCP и навыками'],
      ['MCP/Skills', 'MCP/Навыки'],
      ['MCP/Skills同步', 'Синхронизация MCP и навыков'],
      ['MCP/Skills同步 →', 'Синхронизировать MCP/Skills →'],
      ['🔄 刷新', '🔄 Обновить'],
      ['加载中…', 'Загрузка…'],
      ['启停 / 移除已同步到 DSH 的 MCP 与 skill', 'Включение, отключение и удаление MCP и навыков в DSH'],
      ['（当前会话未挂载 skill 提供方，模型暂不可用，文件已就位）', 'Провайдер навыков не подключён к этой сессии; файлы уже установлены.'],
      ['⇄ 迁移技能', '⇄ Перенести навыки'],
      ['＋ 添加 MCP', '＋ Добавить MCP'],
      ['＋ 添加 Skill', '＋ Добавить навык'],
      ['暂无 profile 数据', 'Данные профиля пока недоступны'],
      ['暂无已同步的 MCP', 'Синхронизированных MCP пока нет'],
      ['暂无已同步的 skill', 'Синхронизированных навыков пока нет'],
      ['该工作区暂无 skill', 'В этом проекте навыков пока нет'],
      ['← 返回', '← Назад'],
      ['从其他 agent 一键同步 MCP 与 skill 进 DSH', 'Импорт MCP и навыков из других агентов в DSH'],
      ['更多 ▾', 'Ещё ▾'],
      ['无自定义源', 'Пользовательских источников нет'],
      ['名称', 'Название'],
      ['类型', 'Тип'],
      ['目录 (skills)', 'Папка с навыками'],
      ['路径', 'Путь'],
      ['绝对路径', 'Абсолютный путь'],
      ['添加', 'Добавить'],
      ['插件设置', 'Настройки плагина'],
      ['⚙️ 设置', '⚙️ Настройки'],
      ['✕ 关闭', '✕ Закрыть'],
      ['Skill 同步方式', 'Способ синхронизации навыков'],
      ['文件复制（默认）', 'Копирование файлов (по умолчанию)'],
      ['软连接（链接源目录，实时同步）', 'Ссылка на исходную папку (обновляется автоматически)'],
      ['MCP 同步目标', 'Профили для MCP'],
      ['全部 profile（desktop + web）', 'Все профили (desktop + web)'],
      ['仅 desktop', 'Только desktop'],
      ['仅 web', 'Только web'],
      ['保存', 'Сохранить'],
      ['全选本页', 'Выбрать всё на странице'],
      ['同步选中 MCP', 'Синхронизировать выбранные MCP'],
      ['同步到', 'Синхронизировать в'],
      ['全局 (~/.dsh/skills)', 'Глобально (~/.dsh/skills)'],
      ['同步选中 Skill', 'Синхронизировать выбранные навыки'],
      ['覆盖同步', 'Перезаписать'],
      ['添加技能', 'Добавить навык'],
      ['添加到', 'Добавить в'],
      ['全局', 'Глобально'],
      ['选择来源', 'Выберите источник'],
      ['📁 选择文件夹', '📁 Выбрать папку'],
      ['📄 选择单个 .md', '📄 Выбрать файл .md'],
      ['📦 选择 .zip', '📦 Выбрать .zip'],
      ['拖放', 'Перетащить'],
      ['将 .md / .zip / 技能文件夹拖到这里', 'Перетащите сюда .md, .zip или папку навыка'],
      ['文件夹需包含 SKILL.md（目录束）；单文件需为带 frontmatter 的 .md', 'Папка должна содержать SKILL.md; одиночный .md — frontmatter.'],
      ['添加 MCP 服务器', 'Добавить MCP-сервер'],
      ['传输方式', 'Транспорт'],
      ['stdio（本地命令）', 'stdio (локальная команда)'],
      ['命令', 'Команда'],
      ['参数', 'Аргументы'],
      ['环境变量', 'Переменные окружения'],
      ['KEY=VALUE，每行一个', 'KEY=VALUE, по одной на строку'],
      ['添加到 DSH 的 MCP 客户端（重启后生效）', 'MCP будет добавлен в DSH после перезапуска.'],
      ['迁移技能', 'Перенести навыки'],
      ['选择技能', 'Выберите навыки'],
      ['当前作用域没有技能', 'В этой области нет навыков'],
      ['迁移到', 'Перенести в'],
      ['方式', 'Способ'],
      ['移动（删除源）', 'Переместить (удалить источник)'],
      ['复制（保留源）', 'Копировать (сохранить источник)'],
      ['复制到目标作用域，源位置保留', 'Копия будет создана в целевой области, источник сохранится.'],
      ['迁移 = 移动到目标作用域（源位置删除）', 'Перемещение удалит навык из исходной области.'],
      ['复制', 'Копировать'],
      ['迁移', 'Перенести'],
      ['编辑分组', 'Изменить группу'],
      ['新建分组', 'Новая группа'],
      ['分组名称', 'Название группы'],
      ['输入分组名称（必填）', 'Введите название группы'],
      ['删除分组', 'Удалить группу'],
      ['保存分组', 'Сохранить группу'],
      ['＋ 分组', '＋ Группа'],
      ['全部', 'Все'],
      ['🔍 搜索技能…', '🔍 Поиск навыков…'],
      ['启用', 'Включён'],
      ['已停用', 'Выключен'],
      ['🔗 软连接', '🔗 Ссылка'],
      ['移除', 'Удалить'],
      ['确认删除?', 'Удалить?'],
      ['点击停用', 'Нажмите, чтобы выключить'],
      ['点击启用', 'Нажмите, чтобы включить'],
      ['MCP 详情', 'Сведения об MCP'],
      ['Skill 详情', 'Сведения о навыке'],
      ['Skills', 'Навыки'],
      ['来源', 'Источник'],
      ['描述', 'Описание'],
      ['仓库', 'Репозиторий'],
      ['内容', 'Содержимое'],
      ['错误', 'Ошибка'],
      ['环境变量(键)', 'Переменные окружения (имена)'],
      ['Headers(键)', 'Заголовки (имена)'],
      ['(空)', '(пусто)'],
      ['自定义', 'Пользовательский'],
    ])

    const AUTOMATION_TEMPLATES = [
      {
        title: 'Проверка кода',
        name: 'Проверка качества кода',
        permission: 'read-only',
        prompt: 'Проверь состояние проекта без изменения файлов. Определи штатные команды тестов, линтера и проверки типов, запусти только безопасные проверки, сгруппируй ошибки по первопричине и приложи краткие доказательства. Не устанавливай зависимости, не делай commit, push или deploy.',
      },
      {
        title: 'Проверка новых данных',
        name: 'Проверка свежести данных',
        permission: 'read-only',
        prompt: 'Проверь, появились ли новые валидные данные. Проверь источник, обязательные срезы, объём, свежесть и целостность результата; HTTP 200 сам по себе не считается успехом. Ничего не меняй. Если данные отсутствуют или устарели, укажи точную причину и безопасный следующий шаг.',
      },
      {
        title: 'Исправление парсера',
        name: 'Контролируемое восстановление парсера',
        permission: 'workspace-write',
        prompt: 'Проверь, получил ли парсер новые валидные данные. Сохрани текущие данные и LKG. Если сбор сломан, воспроизведи сбой на минимальном примере, сделай только минимальное локальное исправление, запусти профильные тесты и проверку контракта источника. Не выполняй deploy, commit или push и остановись после одной проверенной попытки.',
      },
    ]

    function applyBrandHeadline(root = document.body) {
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.trim() === DEFAULT_HEADLINE) {
          node.nodeValue = node.nodeValue.replace(DEFAULT_HEADLINE, BRAND_HEADLINE)
        }
      }
    }

    function setControlledValue(element, value) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    function fillAutomationTemplate(template) {
      const form = document.querySelector('.dsh-automation-create')
      if (!form) return false
      const name = form.querySelector('.dsh-automation-form-grid > label:first-child input')
      const prompt = form.querySelector('textarea')
      if (name instanceof HTMLInputElement) setControlledValue(name, template.name)
      if (prompt instanceof HTMLTextAreaElement) setControlledValue(prompt, template.prompt)
      const permission = form.querySelector(`input[type="radio"][value="${template.permission}"]`)
      if (permission instanceof HTMLInputElement && !permission.checked) permission.click()
      name?.focus()
      return true
    }

    function openAutomationTemplate(template) {
      if (fillAutomationTemplate(template)) return
      const open = document.querySelector('.dsh-automation-header > .dsh-automation-button--primary')
      if (open instanceof HTMLButtonElement) {
        open.click()
        window.setTimeout(() => { fillAutomationTemplate(template) }, 0)
      }
    }

    function ensureAutomationQuickstart() {
      const shell = document.querySelector('.dsh-automation-shell')
      const scope = shell?.querySelector('.dsh-automation-scope')
      if (!shell || !scope || shell.querySelector('.gildra-automation-quickstart')) return

      const quickstart = document.createElement('section')
      quickstart.className = 'gildra-automation-quickstart'
      quickstart.setAttribute('aria-label', 'Быстрый запуск автоматизации')
      const heading = document.createElement('strong')
      heading.textContent = 'Быстрый запуск'
      const hint = document.createElement('p')
      hint.textContent = 'Выберите готовый сценарий, затем задайте модель и расписание.'
      const list = document.createElement('div')
      list.className = 'gildra-automation-template-list'
      for (const template of AUTOMATION_TEMPLATES) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = template.title
        button.addEventListener('click', () => { openAutomationTemplate(template) })
        list.appendChild(button)
      }
      quickstart.append(heading, hint, list)
      scope.insertAdjacentElement('afterend', quickstart)
    }

    function applyAutomationTranslations() {
      const roots = document.querySelectorAll('.dsh-automation-shell, .dsh-automation-sidebar-action, [data-dsh-automation-entry], [data-dsh-automations-trigger], [role="tab"], [role="dialog"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = AUTOMATION_TEXT.get(node.nodeValue?.trim())
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
          const translated = AUTOMATION_PLACEHOLDERS.get(element.getAttribute('placeholder'))
          if (translated) element.setAttribute('placeholder', translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = AUTOMATION_TEXT.get(element.getAttribute(attribute))
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
      for (const entry of document.querySelectorAll('[data-dsh-automation-entry], [data-dsh-automations-trigger]')) {
        entry.setAttribute('aria-label', 'Открыть автоматизации')
        entry.setAttribute('title', 'Автоматизации')
      }
    }

    const AGENT_SYNC_PATTERNS = [
      [/^全部 \((\d+)\)$/, 'Все ($1)'],
      [/^自定义 \((\d+)\)$/, 'Пользовательский ($1)'],
      [/^全局 \((\d+)\)$/, 'Глобально ($1)'],
      [/^工作区: (.+)$/, 'Проект: $1'],
      [/^可同步的 MCP \((\d+)\)$/, 'Доступные MCP ($1)'],
      [/^可同步的 Skills \((\d+)\)$/, 'Доступные навыки ($1)'],
      [/^自定义源 \((\d+)\)$/, 'Пользовательские источники ($1)'],
      [/^已启用 (.+)$/, 'Включено: $1'],
      [/^已停用 (.+)$/, 'Выключено: $1'],
      [/^已移除 (.+)$/, 'Удалено: $1'],
      [/^已删除 (.+)$/, 'Удалено: $1'],
      [/^加载失败: (.+)$/, 'Ошибка загрузки: $1'],
      [/^同步失败: (.+)$/, 'Ошибка синхронизации: $1'],
      [/^移除失败: (.+)$/, 'Ошибка удаления: $1'],
      [/^操作失败: (.+)$/, 'Ошибка операции: $1'],
      [/^保存失败: (.+)$/, 'Ошибка сохранения: $1'],
      [/^删除失败: (.+)$/, 'Ошибка удаления: $1'],
      [/^添加失败: (.+)$/, 'Ошибка добавления: $1'],
      [/^迁移失败: (.+)$/, 'Ошибка переноса: $1'],
      [/^工作区暂无 (.+)$/, 'В проекте пока нет: $1'],
    ]

    function translateAgentSyncValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = AGENT_SYNC_TEXT.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of AGENT_SYNC_PATTERNS) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function applyAgentSyncTranslations() {
      for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
        if (button.textContent?.trim() !== 'MCP/Skills') continue
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
        let text
        while ((text = walker.nextNode())) {
          if (text.nodeValue?.trim() === 'MCP/Skills') {
            text.nodeValue = text.nodeValue.replace('MCP/Skills', 'MCP/Навыки')
            break
          }
        }
      }
      for (const root of document.querySelectorAll('.ags-panel')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateAgentSyncValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateAgentSyncValue(current)
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    function registerRussianPluginDictionaries(ctx) {
      for (const [namespace, dictionary] of Object.entries(PLUGIN_RU_DICTIONARIES)) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(namespace, 'ru', dictionary)
          } catch {
            return undefined
          }
        }, `gildra-ui-compact: Russian dictionary ${namespace}`)
      }
    }

    function applyUiEnhancements() {
      applyBrandHeadline()
      applyAutomationTranslations()
      applyAgentSyncTranslations()
      ensureAutomationQuickstart()
    }

    function handleAutomationEntry(event) {
      const entry = event.target instanceof Element
        ? event.target.closest('[data-dsh-automation-entry]')
        : null
      if (!entry) return
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => ['Automations', 'Автоматизации'].includes(candidate.textContent?.trim()))
      if (!(tab instanceof HTMLElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      tab.click()
      document.querySelector('.dsh-automation-sidebar-feedback')?.remove()
    }

    function apply(ctx) {
      registerRussianPluginDictionaries(ctx)

      ctx.effect(() => {
        const previous = document.querySelector('style[data-gildra-ui-compact]')
        previous?.remove()
        const style = document.createElement('style')
        style.dataset.gildraUiCompact = 'true'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'gildra-ui-compact: styles')

      ctx.effect(() => {
        applyUiEnhancements()
        let frame = 0
        const observer = new MutationObserver(() => {
          window.cancelAnimationFrame(frame)
          frame = window.requestAnimationFrame(applyUiEnhancements)
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        return () => {
          window.cancelAnimationFrame(frame)
          observer.disconnect()
        }
      }, 'gildra-ui-compact: interface enhancements')

      ctx.effect(() => ctx.locale.subscribe(applyUiEnhancements), 'gildra-ui-compact: locale changes')

      ctx.effect(() => {
        const timer = window.setInterval(() => {
          applyAutomationTranslations()
          applyAgentSyncTranslations()
        }, 500)
        return () => window.clearInterval(timer)
      }, 'gildra-ui-compact: plugin interface translation')

      ctx.effect(() => {
        document.addEventListener('click', handleAutomationEntry, true)
        return () => document.removeEventListener('click', handleAutomationEntry, true)
      }, 'gildra-ui-compact: automation navigation')
    }

    exports.apply = apply
    exports.inject = ['locale']
    return module.exports
  },
})
