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
      const name = form.querySelector(SELECTORS.automations.formGridFirstInput)
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
      const shell = document.querySelector(SELECTORS.automations.shell)
      const scope = shell?.querySelector(SELECTORS.automations.scope)
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

