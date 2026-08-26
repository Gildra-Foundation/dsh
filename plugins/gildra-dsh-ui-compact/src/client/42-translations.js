    function translateWithPatterns(value, dictionary, patterns = []) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = dictionary.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function translateAutomationValue(value) {
      return translateWithPatterns(value, AUTOMATION_TEXT, AUTOMATION_PATTERNS)
    }

    function applyAutomationTranslations() {
      if (russianUiSuppressed) return
      const roots = document.querySelectorAll('.dsh-automation-shell, .dsh-auto-workspace, .dsh-automation-sidebar-action, [data-dsh-automation-entry], [data-dsh-automations-trigger], [role="tab"], [role="dialog"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateAutomationValue(node.nodeValue)
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
          const translated = AUTOMATION_PLACEHOLDERS.get(element.getAttribute('placeholder'))
          if (translated) setAttr(element, 'placeholder', translated)
        }
        for (const element of root.querySelectorAll('input.dsh-auto-combobox-input')) {
          const translated = translateAutomationValue(element.value)
          if (translated && document.activeElement !== element && element.value !== translated) {
            element.value = translated
          }
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateAutomationValue(element.getAttribute(attribute))
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
      for (const entry of document.querySelectorAll('[data-dsh-automation-entry], [data-dsh-automations-trigger]')) {
        entry.setAttribute('aria-label', 'Открыть автоматизации')
        entry.setAttribute('title', 'Автоматизации')
      }
    }

    function applySettingsFallbackTranslations() {
      if (russianUiSuppressed) return
      for (const root of document.querySelectorAll('[role="dialog"], [data-composer-seat]')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateWithPatterns(node.nodeValue, SETTINGS_FALLBACK_TEXT, SETTINGS_FALLBACK_PATTERNS)
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateWithPatterns(current, SETTINGS_FALLBACK_TEXT, SETTINGS_FALLBACK_PATTERNS)
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function applyManagedPluginInventoryTranslations() {
      if (russianUiSuppressed) return
      for (const label of document.querySelectorAll('button strong')) {
        const technicalId = label.textContent?.trim()
        const translated = MANAGED_PLUGIN_NAMES_RU.get(technicalId)
        if (!translated) continue
        label.textContent = translated
        label.dataset.gildraPluginId = technicalId
        const row = label.closest('button')
        if (!row) continue
        const ariaLabel = row.getAttribute('aria-label')
        if (ariaLabel?.startsWith(`${technicalId},`)) {
          row.setAttribute('aria-label', `${translated}${ariaLabel.slice(technicalId.length)}`)
        }
        if (!row.hasAttribute('title')) row.setAttribute('title', `Технический ID: ${technicalId}`)
      }
    }

    function applyTerminalTranslations() {
      if (russianUiSuppressed) return
      for (const root of document.querySelectorAll('.dshTermRoot')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateWithPatterns(node.nodeValue, TERMINAL_TEXT, TERMINAL_PATTERNS)
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateWithPatterns(current, TERMINAL_TEXT, TERMINAL_PATTERNS)
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function applySystemMonitorTranslations() {
      if (russianUiSuppressed) return
      const root = document.querySelector('.sysmon')
      if (!root) return
      const replacements = new Map([
        ['SYSTEM', 'СИСТЕМА'],
        ['MEM', 'ОЗУ'],
        ['DISK', 'ДИСК'],
        ['NAME', 'ПРОЦЕСС'],
        ['loading…', 'загрузка…'],
        ['n/a', 'н/д'],
        ['not available on this host', 'недоступно на этом компьютере'],
      ])
      const patterns = [
        [/^(\d+) cores$/, '$1 ядер'],
        [/^(.+) \/ (.+) used$/, '$1 / $2 занято'],
      ]
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const translated = translateWithPatterns(node.nodeValue, replacements, patterns)
        applyTranslatedNodeValue(node, translated)
      }
      const toggle = root.querySelector('.sysmon__toggle')
      if (toggle) {
        const collapsed = toggle.textContent?.trim() === '+'
        setDataset(root, 'gildraCollapsed', String(collapsed))
        const label = collapsed ? 'Открыть системный монитор' : 'Свернуть системный монитор'
        setAttr(toggle, 'aria-label', label)
        setAttr(toggle, 'title', label)
      }
    }

    function applySshRemoteTranslations() {
      if (russianUiSuppressed) return
      for (const root of document.querySelectorAll('[role="menu"], [role="dialog"]')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = SSH_REMOTE_STATUS_TEXT.get(node.nodeValue?.trim())
          applyTranslatedNodeValue(node, translated)
        }
      }
    }

    function applyContextDoctorTranslations() {
      if (russianUiSuppressed) return
      const root = document.querySelector('[role="dialog"][aria-label="Аудит контекста"], [role="dialog"][aria-label="Context Doctor"]')
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const translated = translateWithPatterns(node.nodeValue, CONTEXT_DOCTOR_TEXT, CONTEXT_DOCTOR_PATTERNS)
        applyTranslatedNodeValue(node, translated)
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
      if (russianUiSuppressed) return
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
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateAgentSyncValue(current)
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function translateTeamValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = TEAM_TEXT.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of TEAM_PATTERNS) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function applyTeamTranslations() {
      if (russianUiSuppressed) return
      const roots = document.querySelectorAll('[class$="_stage"], [class*="_stage "], [role="tab"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateTeamValue(node.nodeValue)
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateTeamValue(element.getAttribute(attribute))
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function translateCodeMapValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = CODE_MAP_TEXT.get(trimmed)
      if (exact) return exact
      if (trimmed.startsWith('来源 ')) return `Источник: ${trimmed.slice(3)}`
      if (trimmed.startsWith('更新于 ')) return `Обновлено: ${trimmed.slice(4)}`
      return null
    }

    function applyCodeMapTranslations() {
      if (russianUiSuppressed) return
      const roots = document.querySelectorAll('.cv-panel, [role="tab"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateCodeMapValue(node.nodeValue)
          applyTranslatedNodeValue(node, translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateCodeMapValue(element.getAttribute(attribute))
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function translateWorkspaceFilesValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = WORKSPACE_FILES_TEXT.get(trimmed)
      if (exact) return exact
      const codeLimit = trimmed.match(/^⚠ 文件过长，仅预览前 (\d+) 行$/)
      if (codeLimit) return `⚠ Файл слишком большой: показаны первые ${codeLimit[1]} строк`
      return null
    }

    function applyMappedTranslations(selector, dictionary, translateValue = (value) => dictionary.get(value?.trim())) {
      if (russianUiSuppressed) return
      for (const root of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          applyTranslatedNodeValue(node, translateValue(node.nodeValue))
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateValue(current)
            if (translated) setAttr(element, attribute, translated)
          }
        }
      }
    }

    function applyGitHubTranslations() {
      applyMappedTranslations('.ghc-card', GITHUB_TEXT)
    }

    function applyWorkspaceFilesTranslations() {
      applyMappedTranslations('.wsf-root, .wsf-hbtn', WORKSPACE_FILES_TEXT, translateWorkspaceFilesValue)
    }

