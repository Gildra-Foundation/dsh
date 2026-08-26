    function teamTab() {
      return [...document.querySelectorAll(SELECTORS.tabs)].find(tab =>
        tab instanceof HTMLElement
        && tab.offsetParent !== null
        && [
          'Agent team',
          'Команда агентов',
          'Комната команды',
        ].includes(tab.textContent?.trim()))
    }

    function cloneAgentMenuSvg(source, suffix) {
      if (!(source instanceof SVGElement)) return undefined
      const clone = source.cloneNode(true)
      const ids = new Map()
      for (const element of clone.querySelectorAll('[id]')) {
        const previous = element.id
        const next = `${previous}-gildra-${suffix}`
        ids.set(previous, next)
        element.id = next
      }
      for (const element of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          let value = attribute.value
          for (const [previous, next] of ids) value = value.replaceAll(`#${previous}`, `#${next}`)
          if (value !== attribute.value) element.setAttribute(attribute.name, value)
        }
      }
      clone.setAttribute('aria-hidden', 'true')
      return clone
    }

    function positionAgentMenu(popover, trigger) {
      const rect = trigger.getBoundingClientRect()
      const width = popover.offsetWidth || 340
      const height = popover.offsetHeight || 260
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))
      const preferredTop = rect.bottom + 8
      const top = preferredTop + height <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, rect.top - height - 8)
      popover.style.left = `${String(Math.round(left))}px`
      popover.style.top = `${String(Math.round(top))}px`
    }

    function openAgentMenu(ctx, trigger) {
      const previous = document.querySelector('.gildra-agent-menu-popover')
      if (previous) {
        previous.dispatchEvent(new CustomEvent('gildra:close'))
        return
      }
      const currentTeamTab = teamTab()
      const popover = document.createElement('section')
      popover.id = 'gildra-agent-menu'
      popover.className = 'gildra-agent-menu-popover'
      popover.setAttribute('role', 'dialog')
      popover.setAttribute('aria-label', 'Агенты и авто-ревью')
      popover.innerHTML = `
        <header class="gildra-agent-menu-head">
          <div>
            <strong>Агенты</strong>
            <span>Команда и независимая проверка кода</span>
          </div>
          <button class="gildra-agent-menu-close" type="button">Закрыть</button>
        </header>
        <button class="gildra-agent-menu-action" type="button" data-open-agents>
          <strong>${currentTeamTab ? 'Открыть комнату команды' : 'Создать сабагента'}</strong>
          <span>${currentTeamTab ? 'Посмотреть задачи и результаты участников' : 'Настроить роль, задачу и модель участника'}</span>
        </button>
        <section class="gildra-agent-review-block" aria-label="Авто-ревью">
          <div class="gildra-agent-review-head">
            <strong>Авто-ревью</strong>
            <button type="button" data-open-review>Открыть</button>
          </div>
          <label class="gildra-agent-review-label">
            <small>Модель проверки</small>
            <select class="gildra-review-model-select" aria-label="Модель авто-ревью" disabled>
              <option>Загрузка…</option>
            </select>
          </label>
          <span class="gildra-review-model-status">Загружаю настройку…</span>
        </section>
      `
      document.body.appendChild(popover)
      trigger.setAttribute('aria-expanded', 'true')

      let returnFocus = false
      const close = () => {
        document.removeEventListener('mousedown', onOutside)
        document.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', onMove)
        window.removeEventListener('scroll', onMove, true)
        popover.remove()
        trigger.setAttribute('aria-expanded', 'false')
        if (returnFocus && trigger.isConnected) trigger.focus()
      }
      const onOutside = event => {
        if (!popover.contains(event.target) && event.target !== trigger) close()
      }
      const onKey = event => {
        if (event.key === 'Escape') {
          returnFocus = true
          close()
          return
        }
        if (event.key === 'Tab') {
          const focusable = [...popover.querySelectorAll('button:not(:disabled), select:not(:disabled)')]
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }
      const onMove = () => positionAgentMenu(popover, trigger)
      popover.addEventListener('gildra:close', close, { once: true })
      popover.querySelector('.gildra-agent-menu-close').addEventListener('click', () => {
        returnFocus = true
        close()
      })
      document.addEventListener('mousedown', onOutside)
      document.addEventListener('keydown', onKey)
      window.addEventListener('resize', onMove)
      window.addEventListener('scroll', onMove, true)

      const status = popover.querySelector('.gildra-review-model-status')
      const select = popover.querySelector('.gildra-review-model-select')
      const openReview = popover.querySelector('[data-open-review]')
      const reviewButton = document.querySelector('[data-dsh-auto-review-button]')
      openReview.disabled = !(reviewButton instanceof HTMLButtonElement)
      openReview.title = openReview.disabled
        ? 'Панель появится после первого сообщения в сессии.'
        : 'Открыть состояние авто-ревью'
      popover.querySelector('[data-open-agents]').addEventListener('click', () => {
        const tab = teamTab()
        close()
        if (tab instanceof HTMLButtonElement) tab.click()
        else window.setTimeout(() => openAgentLauncher(ctx), 0)
      })
      openReview.addEventListener('click', () => {
        const button = document.querySelector('[data-dsh-auto-review-button]')
        close()
        if (button instanceof HTMLButtonElement) button.click()
      })
      wireReviewModelSelect(ctx, select, status)
      positionAgentMenu(popover, trigger)
      popover.querySelector('[data-open-agents]').focus()
    }

    function ensureAgentCenter(ctx) {
      const seat = document.querySelector('[data-composer-seat]')
      if (!seat) return
      seat.querySelector('.gildra-agent-center')?.remove()
      const presetSlot = seat.querySelector('[data-slot="conversation.hero.agentPreset"]')
      const row = presetSlot?.parentElement
      if (!(row instanceof HTMLElement) || row.querySelector('.gildra-agent-menu-anchor')) return
      const template = presetSlot.querySelector('button')
      if (!(template instanceof HTMLButtonElement)) return
      const trigger = template.cloneNode(false)
      trigger.type = 'button'
      trigger.classList.add('gildra-agent-menu-trigger')
      trigger.removeAttribute('title')
      trigger.setAttribute('aria-label', 'Открыть меню агентов')
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-controls', 'gildra-agent-menu')
      trigger.setAttribute('aria-expanded', 'false')
      const icons = template.querySelectorAll('svg')
      const agentIcon = cloneAgentMenuSvg(icons[0], 'agent')
      const chevron = cloneAgentMenuSvg(icons[icons.length - 1], 'chevron')
      if (agentIcon) trigger.appendChild(agentIcon)
      trigger.appendChild(document.createTextNode('Агенты'))
      if (chevron && chevron !== agentIcon) trigger.appendChild(chevron)
      trigger.addEventListener('click', () => openAgentMenu(ctx, trigger))
      const anchor = document.createElement('span')
      anchor.className = 'gildra-agent-menu-anchor'
      anchor.appendChild(trigger)
      row.appendChild(anchor)
    }

    function ensureReviewPanelModelControl(ctx) {
      for (const panel of document.querySelectorAll('[data-dsh-auto-review-panel]')) {
        if (panel.querySelector('.gildra-review-model-control')) continue
        const control = document.createElement('section')
        control.className = 'gildra-review-model-control'
        control.innerHTML = `
          <label>
            Модель проверки
            <select class="gildra-review-model-select" aria-label="Модель проверки" disabled>
              <option>Загрузка…</option>
            </select>
          </label>
          <span class="gildra-review-model-status">Загружаю настройку…</span>
        `
        const title = panel.querySelector('[data-dsh-auto-review-title]')
        title?.insertAdjacentElement('afterend', control)
        wireReviewModelSelect(
          ctx,
          control.querySelector('.gildra-review-model-select'),
          control.querySelector('.gildra-review-model-status'),
        )
      }
    }

    function closePresetStudio(backdrop) {
      backdrop.remove()
    }

    function openPresetStudio(ctx) {
      document.querySelector('.gildra-preset-studio-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-preset-studio-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-preset-studio-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-preset-studio-title')
      dialog.innerHTML = `
        <header class="gildra-preset-studio-head">
          <div>
            <h2 id="gildra-preset-studio-title">Новый пресет агента</h2>
            <p>Задайте роль, системный промпт и модель. Инженерные инструменты и работа с командой подключаются автоматически.</p>
          </div>
          <button class="gildra-preset-studio-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <form class="gildra-preset-studio-form">
          <label class="gildra-preset-field">
            Название
            <input name="name" maxlength="80" required placeholder="Например, Архитектор" autocomplete="off">
          </label>
          <label class="gildra-preset-field">
            Идентификатор
            <input name="id" maxlength="64" required pattern="[a-z0-9][a-z0-9-]*" placeholder="architect" autocomplete="off" spellcheck="false">
            <small>Латинские буквы, цифры и дефисы.</small>
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Описание
            <input name="description" maxlength="240" placeholder="Когда использовать этого агента">
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Системный промпт
            <textarea name="systemPrompt" maxlength="32000" required placeholder="Ты — ведущий архитектор. Сначала изучай кодовую базу, затем предлагай минимальные проверяемые изменения…"></textarea>
          </label>
          <label class="gildra-preset-field">
            Модель
            <select name="model" disabled><option>Загрузка моделей…</option></select>
          </label>
          <label class="gildra-preset-field">
            Глубина рассуждения
            <select name="effort" disabled><option>По умолчанию модели</option></select>
          </label>
          <p class="gildra-preset-studio-status" role="status">Загружаю доступные модели…</p>
          <div class="gildra-preset-studio-actions">
            <button type="button" data-cancel>Отмена</button>
            <button type="submit" disabled>Создать пресет</button>
          </div>
        </form>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)

      const form = dialog.querySelector('form')
      const name = form.elements.namedItem('name')
      const id = form.elements.namedItem('id')
      const model = form.elements.namedItem('model')
      const effort = form.elements.namedItem('effort')
      const submit = form.querySelector('button[type="submit"]')
      const status = form.querySelector('[role="status"]')
      let idEdited = false

      id.addEventListener('input', () => { idEdited = true })
      name.addEventListener('input', () => {
        if (!idEdited) id.value = slugifyPresetId(name.value)
      })
      const close = () => {
        document.removeEventListener('keydown', onKey)
        closePresetStudio(backdrop)
      }
      dialog.querySelector('.gildra-preset-studio-close').addEventListener('click', close)
      form.querySelector('[data-cancel]').addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      const onKey = (event) => {
        if (event.key !== 'Escape') return
        close()
      }
      document.addEventListener('keydown', onKey)

      void loadModelCatalog(ctx, model, effort, status).then(() => {
        model.disabled = false
        submit.disabled = false
        name.focus()
      }).catch((error) => {
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      })

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (!form.reportValidity()) return
        const { provider, model: modelId } = selectedModel(model, { groups: [] })
        submit.disabled = true
        status.dataset.kind = ''
        status.textContent = 'Создаю и проверяю пресет…'
        try {
          const response = await fetch(PRESET_STUDIO_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              id: id.value,
              name: name.value,
              description: form.elements.namedItem('description').value,
              systemPrompt: form.elements.namedItem('systemPrompt').value,
              provider,
              model: modelId,
              reasoningEffort: effort.value || undefined,
              source: 'engineering',
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          await presetMappings(true)
          status.dataset.kind = 'success'
          status.textContent = 'Пресет создан и проверен. Обновляю список…'
          window.setTimeout(() => window.location.reload(), 650)
        } catch (error) {
          submit.disabled = false
          status.dataset.kind = 'error'
          status.textContent = error instanceof Error ? error.message : String(error)
        }
      })
    }

    function ensurePresetStudioEntry(ctx) {
      if (document.querySelector('.gildra-preset-studio-entry')) return
      const headings = [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')]
      const heading = headings.find(node => /agent\s*presets?|пресет/i.test(node.textContent ?? ''))
      if (!heading || heading.closest('.gildra-preset-studio-dialog')) return
      const section = heading.parentElement
      if (!section) return
      const entry = document.createElement('div')
      entry.className = 'gildra-preset-studio-entry'
      const copy = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = 'Конструктор агентов'
      const hint = document.createElement('span')
      hint.textContent = 'Создайте пресет с собственным системным промптом и закреплённой моделью.'
      copy.append(title, hint)
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Создать пресет'
      button.addEventListener('click', () => openPresetStudio(ctx))
      entry.append(copy, button)
      heading.insertAdjacentElement('afterend', entry)
    }

