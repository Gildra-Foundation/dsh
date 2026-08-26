    const SETTINGS_FALLBACK_TEXT = new Map([
      ['Workspace Write', 'Запись в рабочую папку'],
      ['MCP/Skills', 'MCP/Навыки'],
      ['Proxy', 'Прокси'],
      ['Configure…', 'Настроить…'],
      ['Not configured — subscription requests go direct.', 'Не настроен — запросы подписок идут напрямую.'],
      ['Proxy settings', 'Настройки прокси'],
      ['Close', 'Закрыть'],
      ['Route subscription requests through a proxy', 'Направлять запросы подписок через прокси'],
      ['Proxy URL', 'Адрес прокси'],
      ['HTTP or HTTPS proxy only (Clash/mihomo, v2rayN…); socks is not supported.', 'Только HTTP- или HTTPS-прокси (Clash/mihomo, v2rayN…); SOCKS не поддерживается.'],
      ['Username (optional)', 'Имя пользователя (необязательно)'],
      ['Password', 'Пароль'],
      ['Leave blank to keep the saved password', 'Оставьте пустым, чтобы сохранить текущий пароль'],
      ['Clear the saved password', 'Удалить сохранённый пароль'],
      ['Bypass hosts', 'Исключения'],
      ['Comma-separated hostnames that keep going direct.', 'Имена хостов через запятую, для которых сохраняется прямое соединение.'],
      ['Applies to token exchange, model APIs, usage lookups, image/video generation and x_search. The OAuth authorization page opens in your browser and follows the browser/system proxy, not this setting.', 'Прокси используется для обмена токенов, API моделей, проверки лимитов, создания изображений/видео и x_search. Страница OAuth использует прокси браузера или системы, а не эту настройку.'],
      ['Test', 'Проверить'],
      ['Save', 'Сохранить'],
      ['Proxy username', 'Имя пользователя прокси'],
    ])

    const SETTINGS_FALLBACK_PATTERNS = [
      [/^(.+): (\d+) diagnostic; details are available in Host logs$/, '$1: диагностических сообщений — $2; подробности доступны в журнале хоста'],
    ]

    const MANAGED_PLUGIN_NAMES_RU = new Map([
      ['context7', 'Context7 — документация'],
      ['mcp-panel', 'Панель MCP'],
      ['plugin-terminal', 'Терминал'],
      ['browser', 'Автоматизация браузера'],
      ['notification', 'Уведомления'],
      ['plugins-finder', 'Поиск плагинов'],
    ])

    const TERMINAL_TEXT = new Map([
      ['启动中…', 'Запуск…'],
      ['无会话', 'Нет сессий'],
      ['空闲', 'Готов'],
      ['拖动调整高度', 'Перетащите, чтобы изменить высоту'],
      ['新建终端', 'Новый терминал'],
      ['重启进程（保留标签位）', 'Перезапустить процесс'],
      ['重启当前会话', 'Перезапустить текущую сессию'],
      ['收起面板', 'Свернуть панель'],
      ['没有终端会话', 'Терминал ещё не открыт'],
      ['终端', 'Терминал'],
    ])

    const TERMINAL_PATTERNS = [
      [/^终端(.*)$/, 'Терминал$1'],
      [/^(.+) 已退出，点 ⟳ 重启$/, '$1 завершён — нажмите ⟳ для перезапуска'],
      [/^(.+) \(已退出\)$/, '$1 (завершён)'],
      [/^关闭 (.+)$/, 'Закрыть $1'],
      [/^收起面板（(.+)）$/, 'Свернуть панель ($1)'],
      [/^终端面板（(.+) 切换）$/, 'Панель терминала ($1 — открыть/скрыть)'],
    ]

    const SSH_REMOTE_STATUS_TEXT = new Map([
      ['已连接', 'подключён'],
      ['隧道已通', 'туннель активен'],
      ['离线', 'не в сети'],
      ['错误', 'ошибка'],
      ['加载中…', 'Загрузка…'],
      ['Configured remotes — the local machine is a thin client; agents, files, and sessions run on the remote harness.', 'Настроенные серверы: приложение работает как тонкий клиент, а агенты, файлы и сессии находятся на сервере.'],
      ['Connect', 'Подключить'],
      ['Open', 'Открыть'],
      ['Disconnect', 'Отключить'],
      ['Start', 'Запустить'],
      ['Stop', 'Остановить'],
      ['Logs', 'Журнал'],
    ])

    const CONTEXT_DOCTOR_TEXT = new Map([
      ['tokens resident', 'токенов в контексте'],
      ['files', 'файла'],
      ['skills', 'навыков'],
      ['built-in tools', 'встроенных инструментов'],
      ['nothing injected', 'ничего не добавлено'],
      ['可见工具共 80 个（schema 约 5.2k token），每个请求都会携带，建议检查是否全部需要。', 'Доступно 80 инструментов (схемы занимают около 5,2 тыс. токенов). Проверьте, действительно ли все они нужны в каждом запросе.'],
    ])

    const CONTEXT_DOCTOR_PATTERNS = [
      [/^(\d+) files$/, '$1 файла'],
      [/^(\d+) skills$/, '$1 навыков'],
      [/^(\d+) built-in tools$/, '$1 встроенных инструментов'],
      [/^可见工具共 (\d+) 个（schema 约 (.+) token），每个请求都会携带，建议检查是否全部需要。$/, 'Доступно инструментов: $1 (схемы занимают около $2 токенов). Проверьте, нужны ли они в каждом запросе.'],
    ]

    const CODE_MAP_TEXT = new Map([
      ['画布', 'Карта кода'],
      ['Canvas', 'Карта кода'],
      ['Canvas preview', 'Просмотр карты кода'],
      ['画布为空', 'Карта пока не создана'],
      ['会话智能体可通过 canvas_preview 工具渲染 HTML 设计稿到此处', 'Попросите ИИ построить карту проекта — результат появится здесь.'],
      ['隐私脱敏', 'Защита данных'],
      ['已渲染', 'Готово'],
      ['未渲染', 'Не создано'],
      ['刷新', 'Обновить'],
      ['清空', 'Очистить'],
      ['备注', 'Примечания'],
      ['仅当前会话 · 不落盘', 'Только эта сессия · без сохранения'],
      ['等待渲染', 'Ожидание карты'],
    ])

    const GITHUB_TEXT = new Map([
      ['GitHub pull requests, issues, and CI through the agent.', 'Pull request, задачи и CI GitHub через ИИ.'],
      ['GitHub token', 'Токен GitHub'],
      ['Stored in the credentials file, not here. Applied immediately; leave blank to keep the current token.', 'Хранится отдельно в защищённых учётных данных. Оставьте поле пустым, чтобы сохранить текущий токен.'],
      ['A token is configured.', 'Токен настроен.'],
      ['No token is configured; GitHub tools are unavailable until one is.', 'Токен не сохранён в DSH. При выполненном gh auth login инструменты подключатся автоматически.'],
      ['Unsaved', 'Не сохранено'],
      ['This deployment stores settings read-only.', 'В этой сборке настройки доступны только для чтения.'],
      ['Save', 'Сохранить'],
      ['Saving…', 'Сохранение…'],
      ['Discard', 'Отменить изменения'],
      ['The deployment did not accept this value; it was left for you to correct.', 'Не удалось сохранить значение. Исправьте его и повторите попытку.'],
      ['Expand: GitHub', 'Развернуть: GitHub'],
      ['Collapse: GitHub', 'Свернуть: GitHub'],
    ])

    const WORKSPACE_FILES_TEXT = new Map([
      ['工作区文件', 'Файлы проекта'],
      ['显示/隐藏工作区文件面板', 'Показать или скрыть файлы проекта'],
      ['刷新', 'Обновить'],
      ['关闭', 'Закрыть'],
      ['正在读取工作区…', 'Читаем рабочую папку…'],
      ['正在加载…', 'Загрузка…'],
      ['加载中…', 'Загрузка…'],
      ['读取失败', 'Не удалось прочитать файл'],
      ['读取目录失败', 'Не удалось прочитать папку'],
      ['无法确定工作区根目录', 'Не удалось определить рабочую папку'],
      ['（点击重试）', '(нажмите, чтобы повторить)'],
      ['（空文件）', '(пустой файл)'],
      ['（空目录）', '(пустая папка)'],
      ['图片', 'Изображение'],
      ['文本', 'Текст'],
      ['← 在左侧文件树中选择一个文件进行预览', '← Выберите файл в дереве слева для предпросмотра'],
      ['… 目录过大，仅显示前 500 项', '… Папка слишком большая: показаны первые 500 элементов'],
    ])

