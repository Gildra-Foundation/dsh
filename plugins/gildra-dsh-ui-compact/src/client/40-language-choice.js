    // DOM-словари оверлея переписывают интерфейс плагинов на русский. Если
    // пользователь явно выбрал English в диалоге языка, эти проходы
    // отключаются; до явного выбора поведение прежнее — кит поставляется
    // русскоязычным. Бренд-заголовок не языковой и не гейтится.
    let russianUiSuppressed = false

    function updateRussianUiPreference(ctx) {
      try {
        const locale = String(ctx.locale?.getLocale?.() ?? '')
        russianUiSuppressed = hasLanguageChoice() && locale.toLowerCase().startsWith('en')
      } catch {
        russianUiSuppressed = false
      }
    }

    function applyBrandHeadline(root = document.body) {
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const current = node.nodeValue?.trim()
        if (DEFAULT_HEADLINES.has(current)) {
          setNodeValue(node, node.nodeValue.replace(current, BRAND_HEADLINE))
        } else if (DEFAULT_BUILD_LABELS.has(current)) {
          setNodeValue(node, node.nodeValue.replace(current, 'Gildra DSH'))
        }
      }
    }

    function hasLanguageChoice() {
      try {
        return window.localStorage.getItem(LANGUAGE_CHOICE_KEY) === 'done'
      } catch {
        return false
      }
    }

    function ensureLanguageChoice(ctx) {
      if (hasLanguageChoice() || document.querySelector('.gildra-language-backdrop')) return
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-language-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-language-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-language-title')
      dialog.setAttribute('aria-describedby', 'gildra-language-description')
      dialog.innerHTML = `
        <h1 id="gildra-language-title">Choose your language · Выберите язык</h1>
        <p id="gildra-language-description">You can change it later in Settings. Язык можно изменить позже в настройках.</p>
        <div class="gildra-language-options">
          <button type="button" data-language="en">
            <strong>English</strong>
            <small>Use the application in English</small>
          </button>
          <button type="button" data-language="ru">
            <strong>Русский</strong>
            <small>Использовать приложение на русском языке</small>
          </button>
        </div>
        <p class="gildra-language-status" role="status" aria-live="polite"></p>
      `
      backdrop.appendChild(dialog)
      const siblings = [...document.body.children]
      const inertState = siblings.map(element => ({ element, inert: element.inert }))
      for (const { element } of inertState) element.inert = true
      document.body.appendChild(backdrop)

      const buttons = [...dialog.querySelectorAll('button[data-language]')]
      const status = dialog.querySelector('[role="status"]')
      const close = () => {
        for (const item of inertState) item.element.inert = item.inert
        backdrop.remove()
      }
      const choose = (event) => {
        const button = event.currentTarget
        const language = button.dataset.language
        for (const candidate of buttons) candidate.disabled = true
        try {
          ctx.locale.setLocale(language)
          try { window.localStorage.setItem(LANGUAGE_CHOICE_KEY, 'done') } catch {}
          close()
        } catch (error) {
          for (const candidate of buttons) candidate.disabled = false
          status.textContent = error instanceof Error ? error.message : String(error)
          button.focus()
        }
      }
      for (const button of buttons) button.addEventListener('click', choose)
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return
        const enabled = buttons.filter(button => !button.disabled)
        if (enabled.length === 0) return
        const first = enabled[0]
        const last = enabled.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      })
      const active = ctx.locale.getLocale().active
      const preferred = buttons.find(button => button.dataset.language === active) ?? buttons[0]
      preferred.focus()
    }

