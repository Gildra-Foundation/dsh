    let updateStatusPromise

    async function fetchUpdateStatus(force = false) {
      if (force) updateStatusPromise = undefined
      updateStatusPromise ??= fetch(UPDATE_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.ok !== true || typeof body.status !== 'object') {
          throw new Error(body.error ?? `HTTP ${String(response.status)}`)
        }
        return body.status
      }).catch((error) => {
        updateStatusPromise = undefined
        throw error
      })
      return updateStatusPromise
    }

    function openUpdateDialog() {
      document.querySelector('.gildra-update-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-repository-backdrop gildra-update-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-repository-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-update-title')
      dialog.innerHTML = `
        <header class="gildra-repository-head">
          <div>
            <h2 id="gildra-update-title">Обновление Gildra DSH</h2>
            <p>Обновляет Harness, плагины и приложение. Ваши проекты, сессии, авторизации и настройки сохраняются.</p>
          </div>
          <button class="gildra-repository-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="gildra-repository-form">
          <div class="gildra-update-summary">
            <div class="gildra-update-version"><small>Установлено</small><strong data-current>—</strong></div>
            <div class="gildra-update-version"><small>Последний выпуск</small><strong data-latest>—</strong></div>
          </div>
          <p class="gildra-update-notice">Проверяю официальный канал выпусков Gildra…</p>
          <p class="gildra-repository-status" role="status">Подключение к GitHub…</p>
          <div class="gildra-repository-actions">
            <button type="button" data-close>Закрыть</button>
            <button type="button" data-install disabled>Установить обновление</button>
          </div>
        </div>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)
      const current = dialog.querySelector('[data-current]')
      const latest = dialog.querySelector('[data-latest]')
      const notice = dialog.querySelector('.gildra-update-notice')
      const status = dialog.querySelector('[role="status"]')
      const install = dialog.querySelector('[data-install]')
      let busy = false

      const close = () => {
        if (busy) return
        document.removeEventListener('keydown', onKey)
        backdrop.remove()
      }
      const onKey = event => { if (event.key === 'Escape') close() }
      dialog.querySelector('.gildra-repository-close').addEventListener('click', close)
      dialog.querySelector('[data-close]').addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      document.addEventListener('keydown', onKey)

      void fetchUpdateStatus(true).then((value) => {
        current.textContent = value.currentVersion || 'неизвестно'
        latest.textContent = value.latestVersion || 'неизвестно'
        if (value.updateAvailable && value.assetAvailable) {
          notice.textContent = `Доступна версия ${value.latestVersion}. Архив проверяется по SHA-256, затем приложение перезапустится автоматически.`
          status.dataset.kind = 'success'
          status.textContent = 'Обновление готово к установке.'
          install.disabled = false
          install.textContent = `Установить ${value.latestVersion}`
          document.querySelector('.gildra-update-sidebar-entry')?.setAttribute('data-update-available', 'true')
        } else if (value.updateAvailable) {
          notice.textContent = 'В выпуске пока нет готового архива для этой операционной системы.'
          status.dataset.kind = 'error'
          status.textContent = 'Автоматическая установка этого выпуска недоступна.'
        } else {
          notice.textContent = value.currentVersion === value.latestVersion
            ? 'У вас установлена последняя стабильная версия.'
            : 'Установленная сборка новее последнего опубликованного стабильного выпуска.'
          status.dataset.kind = 'success'
          status.textContent = 'Обновление не требуется.'
        }
        if (value.lastUpdate?.status === 'error') {
          status.dataset.kind = 'error'
          status.textContent = `Предыдущее обновление не завершилось: ${value.lastUpdate.error ?? 'неизвестная ошибка'}`
        }
      }).catch((error) => {
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
        notice.textContent = 'Проверьте подключение к интернету и повторите попытку позже.'
      })

      install.addEventListener('click', async () => {
        busy = true
        install.disabled = true
        dialog.querySelector('[data-close]').disabled = true
        dialog.querySelector('.gildra-repository-close').disabled = true
        status.dataset.kind = ''
        status.textContent = 'Запускаю безопасное обновление…'
        try {
          const response = await fetch(UPDATE_ENDPOINT, {
            method: 'POST',
            headers: { 'x-gildra-action': 'install-update', accept: 'application/json' },
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          status.dataset.kind = 'success'
          status.textContent = 'Обновление скачивается. После проверки приложение закроется и откроется снова.'
          notice.textContent = 'Не выключайте компьютер до повторного запуска Gildra DSH.'
        } catch (error) {
          busy = false
          install.disabled = false
          dialog.querySelector('[data-close]').disabled = false
          dialog.querySelector('.gildra-repository-close').disabled = false
          status.dataset.kind = 'error'
          status.textContent = error instanceof Error ? error.message : String(error)
        }
      })
    }

    function ensureUpdateEntry() {
      if (document.querySelector('.gildra-update-sidebar-entry')) return
      const settings = [...document.querySelectorAll('button')].find(button => [
        'Settings', 'Настройки',
      ].includes(button.getAttribute('aria-label') ?? button.textContent?.trim()))
      const wrapper = settings?.parentElement
      const area = wrapper?.parentElement
      if (!settings || !wrapper || !area) return
      const entry = wrapper.cloneNode(false)
      entry.removeAttribute('id')
      entry.classList.add('gildra-update-sidebar-entry')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = settings.className
      button.setAttribute('aria-label', 'Обновления')
      button.setAttribute('title', 'Проверить обновления')
      button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15.7 7.2A6.2 6.2 0 1 0 16 12"/><path d="M12.8 7.2h2.9V4.3"/></svg><span>Обновления</span>'
      button.addEventListener('click', openUpdateDialog)
      entry.appendChild(button)
      area.insertBefore(entry, wrapper)
      void fetchUpdateStatus().then(value => {
        if (value.updateAvailable && value.assetAvailable) entry.dataset.updateAvailable = 'true'
      }).catch(() => {})
    }

