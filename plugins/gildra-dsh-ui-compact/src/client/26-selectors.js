
    // --- Реестр upstream-селекторов ------------------------------------
    // Централизованное знание о вёрстке DeepSeek Harness: любая правка
    // селектора делается здесь, а не по десяти местам кода. Для каждой
    // записи — поверхность и режим отказа: функциональные ensure-фичи при
    // смене upstream молча исчезают, переводы деградируют в исходный язык.
    // CSS-литералы в блоке стилей намеренно не выведены сюда: CSS не читает
    // JS-константы, а дублирование зафиксировано контракт-тестом счётчиков.
    const SELECTORS = Object.freeze({
      sidebar: {
        // Бренд-слот сайдбара; исчезнет — пропадут бейдж среды и заголовок.
        brandName: '[data-slot="sidebar.brand.name"]',
        // Слот списка воркспейсов; якорь позиционирования панели сред.
        workspaces: '[data-slot="sidebar.workspaces"]',
        // Подписи кнопки открытия свёрнутой панели (три локали upstream).
        openSidebarLabels: ['Открыть панель', 'Open sidebar', '打开侧边栏'],
        // Эвристика свёрнутого сайдбара: узкий контент слота.
        collapsedWidthPx: 140,
        // Подписи легаси-кнопки SSH; строка прячется CSS-классом.
        sshTriggerLabels: ['Сервер SSH', 'SSH Remote', 'SSH 远端'],
      },
      sysmon: {
        root: '.sysmon',
        toggle: '.sysmon__toggle',
      },
      automations: {
        shell: '.dsh-automation-shell',
        scope: '.dsh-automation-scope',
        formGridFirstInput: '.dsh-automation-form-grid > label:first-child input',
        sidebarFeedback: '.dsh-automation-sidebar-feedback',
        translationRoots: '.dsh-automation-shell, .dsh-auto-workspace, .dsh-automation-sidebar-action, [data-dsh-automation-entry], [data-dsh-automations-trigger], [role="tab"], [role="dialog"]',
      },
      tabs: '[role="tab"]',
    })
