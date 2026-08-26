    function suggestedRepositoryFolder(value) {
      try {
        return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).at(-1) ?? '')
          .replace(/\.git$/i, '')
      } catch {
        return ''
      }
    }

    function openRepositoryImport(ctx) {
      document.querySelector('.gildra-repository-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-repository-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-repository-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-repository-title')
      dialog.innerHTML = `
        <header class="gildra-repository-head">
          <div>
            <h2 id="gildra-repository-title">Добавить репозиторий</h2>
            <p>Вставьте ссылку — Gildra клонирует проект и сразу откроет его как рабочую папку.</p>
          </div>
          <button class="gildra-repository-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <form class="gildra-repository-form">
          <label class="gildra-repository-field">
            HTTPS-ссылка на репозиторий
            <input name="url" type="url" maxlength="2048" required autofocus
              placeholder="https://github.com/organization/project.git" autocomplete="off" spellcheck="false">
            <small>Поддерживаются GitHub, GitLab и Bitbucket. Для приватного репозитория Git должен иметь доступ заранее.</small>
          </label>
          <label class="gildra-repository-field">
            Имя папки <small>(необязательно)</small>
            <input name="folderName" maxlength="80" placeholder="Автоматически из ссылки" autocomplete="off" spellcheck="false">
            <small>Проект будет сохранён в папке «Gildra Projects» в вашем профиле.</small>
          </label>
          <p class="gildra-repository-status" role="status">Готово к импорту.</p>
          <div class="gildra-repository-actions">
            <button type="button" data-cancel>Отмена</button>
            <button type="submit">Клонировать и открыть</button>
          </div>
        </form>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)

      const form = dialog.querySelector('form')
      const url = form.elements.namedItem('url')
      const folderName = form.elements.namedItem('folderName')
      const submit = form.querySelector('button[type="submit"]')
      const cancel = form.querySelector('[data-cancel]')
      const closeButton = dialog.querySelector('.gildra-repository-close')
      const status = form.querySelector('[role="status"]')
      let folderEdited = false
      let busy = false

      folderName.addEventListener('input', () => { folderEdited = true })
      url.addEventListener('input', () => {
        if (!folderEdited) folderName.value = suggestedRepositoryFolder(url.value)
      })
      const close = () => {
        if (busy) return
        document.removeEventListener('keydown', onKey)
        backdrop.remove()
      }
      const onKey = (event) => {
        if (event.key === 'Escape') close()
      }
      closeButton.addEventListener('click', close)
      cancel.addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      document.addEventListener('keydown', onKey)
      url.focus()

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (!form.reportValidity()) return
        busy = true
        submit.disabled = true
        cancel.disabled = true
        closeButton.disabled = true
        status.dataset.kind = ''
        status.textContent = 'Клонирую репозиторий. Большой проект может занять несколько минут…'
        let clonedPath
        try {
          const response = await fetch(REPOSITORY_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ url: url.value, folderName: folderName.value || undefined }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true || typeof body.workspace?.path !== 'string') {
            throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          }
          clonedPath = body.workspace.path
          status.textContent = 'Репозиторий готов. Добавляю рабочую папку…'
          const workspace = await ctx.workspaces.create({ path: clonedPath })
          ctx.workspaces.startSession(workspace.workspaceId)
          status.dataset.kind = 'success'
          status.textContent = `Проект «${body.workspace.name}» добавлен и открыт.`
          busy = false
          window.setTimeout(close, 500)
        } catch (error) {
          busy = false
          submit.disabled = false
          cancel.disabled = false
          closeButton.disabled = false
          status.dataset.kind = 'error'
          const message = error instanceof Error ? error.message : String(error)
          status.textContent = clonedPath
            ? `Репозиторий сохранён в ${clonedPath}, но не добавлен в список: ${message}`
            : message
        }
      })
    }

    function ensureRepositoryEntry(ctx) {
      const buttons = [...document.querySelectorAll('button[aria-label]')]
      const addWorkspace = buttons.find(button => [
        'Add workspace',
        'Добавить рабочую папку',
      ].includes(button.getAttribute('aria-label')))
      const parent = addWorkspace?.parentElement
      if (!addWorkspace || !parent || parent.querySelector('.gildra-repository-add')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `${addWorkspace.className} gildra-repository-add`
      button.setAttribute('aria-label', 'Добавить репозиторий по ссылке')
      button.setAttribute('title', 'Добавить репозиторий по ссылке')
      button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="3" r="1.75"/><circle cx="4" cy="13" r="1.75"/><circle cx="12" cy="8" r="1.75"/><path d="M4 4.75v6.5M5.75 4.5c3.2 0 2.9 3.5 4.5 3.5"/></svg>'
      button.addEventListener('click', () => openRepositoryImport(ctx))
      addWorkspace.insertAdjacentElement('afterend', button)
    }

    function ensureNativeWorkspacePicker(ctx) {
      if (!window.gildraHost || typeof window.gildraHost.call !== 'function') return
      const button = [...document.querySelectorAll('button[aria-label]')].find(candidate => [
        'Add workspace',
        'Добавить рабочую папку',
      ].includes(candidate.getAttribute('aria-label')))
      if (!button || button.dataset.gildraHostPicker === 'true') return
      button.dataset.gildraHostPicker = 'true'
      button.addEventListener('click', async (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
        try {
          const result = await window.gildraHost.call('files.chooseDirectory')
          if (result?.cancelled || typeof result?.path !== 'string') return
          const workspace = await ctx.workspaces.create({ path: result.path })
          ctx.workspaces.startSession(workspace.workspaceId)
        } catch (error) {
          window.alert(`Не удалось добавить рабочую папку: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, true)
    }

