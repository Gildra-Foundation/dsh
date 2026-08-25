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
      const roots = document.querySelectorAll('.dsh-automation-shell, .dsh-automation-sidebar-action, [role="tab"]')
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
      const entry = document.querySelector('[data-dsh-automation-entry]')
      if (entry) {
        entry.setAttribute('aria-label', 'Открыть автоматизации')
        entry.setAttribute('title', 'Открыть автоматизации')
      }
    }

    function applyUiEnhancements() {
      applyBrandHeadline()
      applyAutomationTranslations()
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
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
              applyBrandHeadline(mutation.target.parentElement)
              continue
            }
            for (const node of mutation.addedNodes) {
              applyBrandHeadline(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
            }
          }
          applyAutomationTranslations()
          ensureAutomationQuickstart()
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        return () => observer.disconnect()
      }, 'gildra-ui-compact: interface enhancements')

      ctx.effect(() => {
        document.addEventListener('click', handleAutomationEntry, true)
        return () => document.removeEventListener('click', handleAutomationEntry, true)
      }, 'gildra-ui-compact: automation navigation')
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
