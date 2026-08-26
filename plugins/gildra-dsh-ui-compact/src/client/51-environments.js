    function safeHarnessURL(value) {
      try {
        if (typeof value !== 'string' || value.trim() === '') return null
        const url = new URL(value, window.location.href)
        const host = url.hostname.toLowerCase()
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) return null
        if (url.username || url.password) return null
        return `${url.origin}/`
      } catch {
        return null
      }
    }

    function environmentOrigin(value) {
      const safe = safeHarnessURL(value)
      return safe ? new URL(safe).origin : null
    }

    function safeFleet(value) {
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const fleet = []
      for (const entry of value.slice(0, 20)) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
        const host = typeof entry?.host === 'string' ? entry.host.trim() : ''
        const localPort = Number(entry?.localPort)
        if (!name || name.length > 80 || /[\0\r\n]/.test(name)) continue
        if (host.length > 255 || /[\0\r\n]/.test(host)) continue
        if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535 || seen.has(name)) continue
        seen.add(name)
        fleet.push({ name, host, localPort, connected: true, tunnel: { up: true } })
      }
      return fleet
    }

    function readEnvironmentSession() {
      try {
        const value = JSON.parse(window.sessionStorage.getItem(ENVIRONMENT_SESSION_KEY) ?? 'null')
        return value && typeof value === 'object' ? value : null
      } catch {
        return null
      }
    }

    function queryRemoteContext() {
      const query = new URLSearchParams(window.location.search)
      const name = query.get('gildraRemote')
      if (!name) return null
      let fleet = []
      try {
        fleet = safeFleet(JSON.parse(query.get('gildraFleet') ?? '[]'))
      } catch {
        // Older links do not carry the local fleet.
      }
      return {
        name,
        host: query.get('gildraRemoteHost') ?? '',
        localURL: safeHarnessURL(query.get('gildraLocal')) ?? '',
        fleet,
      }
    }

    function persistEnvironmentSession(value) {
      try {
        window.sessionStorage.setItem(ENVIRONMENT_SESSION_KEY, JSON.stringify(value))
      } catch {
        // Private browsing and hardened WebViews may disable sessionStorage.
      }
    }

    function environmentPreferences() {
      try {
        const value = JSON.parse(window.localStorage.getItem(ENVIRONMENT_PREFERENCES_KEY) ?? 'null')
        return value && typeof value === 'object' ? value : { localPorts: {} }
      } catch {
        return { localPorts: {} }
      }
    }

    function rememberRemotePort(name, localPort) {
      if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) return
      try {
        const preferences = environmentPreferences()
        preferences.localPorts = { ...preferences.localPorts, [name]: localPort }
        window.localStorage.setItem(ENVIRONMENT_PREFERENCES_KEY, JSON.stringify(preferences))
      } catch {
        // A stable port is an optimization; connecting still works without it.
      }
    }

    function preferredRemotePort(name) {
      const value = environmentPreferences().localPorts?.[name]
      return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : undefined
    }

    async function resolveLocalHarnessURL() {
      const query = queryRemoteContext()
      const saved = readEnvironmentSession()
      const host = window.gildraHost
      if (host && typeof host.call === 'function') {
        try {
          const status = await host.call('processes.status')
          const serverURL = typeof status?.serverURL === 'string' ? safeHarnessURL(status.serverURL) : null
          if (serverURL) {
            return serverURL
          }
        } catch {
          // The browser-only build intentionally has no native host status.
        }
      }
      if (query?.localURL && environmentOrigin(query.localURL)) return query.localURL
      if (saved?.localURL && environmentOrigin(saved.localURL)) return saved.localURL
      if (query || saved?.name) return 'http://127.0.0.1:3080/'
      return window.location.origin + '/'
    }

    function currentRemoteContext(localURL) {
      const query = queryRemoteContext()
      const saved = readEnvironmentSession()
      const isRemoteOrigin = environmentOrigin(localURL) !== window.location.origin
      if (!isRemoteOrigin) return null
      const context = query ?? saved ?? {}
      return {
        name: typeof context.name === 'string' && context.name ? context.name : 'Удалённый сервер',
        host: typeof context.host === 'string' ? context.host : '',
        localURL,
        fleet: safeFleet(context.fleet),
      }
    }

    function environmentStateText(remote, active) {
      if (environmentState.busy === remote.name) return 'Подключение…'
      if (active || remote.connected) return 'Подключён'
      if (remote.tunnel?.up) return 'Туннель готов'
      return 'Не подключён'
    }

    function makeEnvironmentRow({ name, detail, state, kind, active, disabled, onClick }) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gildra-environment-row'
      button.dataset.state = kind
      button.setAttribute('aria-current', active ? 'true' : 'false')
      button.setAttribute('aria-label', `${name}. ${detail}. ${state}`)
      button.disabled = disabled
      const dot = document.createElement('span')
      dot.className = 'gildra-environment-dot'
      dot.setAttribute('aria-hidden', 'true')
      const copy = document.createElement('span')
      copy.className = 'gildra-environment-copy'
      const title = document.createElement('span')
      title.className = 'gildra-environment-name'
      title.textContent = name
      const subtitle = document.createElement('span')
      subtitle.className = 'gildra-environment-detail'
      subtitle.textContent = detail
      copy.append(title, subtitle)
      const status = document.createElement('span')
      status.className = 'gildra-environment-state'
      status.textContent = state
      button.append(dot, copy, status)
      button.addEventListener('click', onClick)
      return button
    }

    function environmentGroup(title, refreshable = false) {
      const group = document.createElement('section')
      group.className = 'gildra-environment-group'
      const heading = document.createElement('div')
      heading.className = 'gildra-environment-heading'
      heading.textContent = title
      if (refreshable) {
        const refresh = document.createElement('button')
        refresh.type = 'button'
        refresh.className = 'gildra-environment-refresh'
        refresh.textContent = 'Обновить'
        refresh.setAttribute('aria-label', 'Обновить список серверов')
        refresh.addEventListener('click', () => void refreshEnvironmentState(true))
        heading.appendChild(refresh)
      }
      const list = document.createElement('div')
      list.className = 'gildra-environment-list'
      group.append(heading, list)
      return { group, list }
    }

    function navigateToLocalEnvironment() {
      if (!environmentState.localURL) return
      window.location.assign(environmentState.localURL)
    }

    function openRemoteEnvironment(remote, value) {
      const safe = safeHarnessURL(value)
      if (!safe) throw new Error('Удалённая среда вернула небезопасный локальный адрес.')
      const target = new URL(safe)
      target.searchParams.set('gildraRemote', remote.name)
      target.searchParams.set('gildraRemoteHost', remote.host ?? '')
      target.searchParams.set('gildraLocal', environmentState.localURL)
      const fleet = safeFleet(environmentState.remotes.map((entry) => ({
        name: entry.name,
        host: entry.host,
        localPort: entry.localPort,
      })))
      target.searchParams.set('gildraFleet', JSON.stringify(fleet.map(({ name, host, localPort }) => ({ name, host, localPort }))))
      window.location.assign(target.href)
    }

    async function requestRemoteConnection(remote) {
      if (remote.tunnel?.up && !remote.connected) {
        await fetch(SSH_REMOTES_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', args: { name: remote.name } }),
        }).catch(() => undefined)
      }
      const connect = async (localPort) => {
        const response = await fetch(SSH_REMOTES_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'connect',
            args: { name: remote.name, ...(localPort ? { localPort } : {}) },
          }),
        })
        const body = await response.json().catch(() => ({}))
        return { response, body }
      }
      const preferredPort = preferredRemotePort(remote.name) ?? remote.localPort
      let result = await connect(preferredPort)
      if ((!result.response.ok || result.body.ok !== true) && preferredPort) {
        result = await connect(undefined)
      }
      const { response, body } = result
      if (!response.ok || body.ok !== true || typeof body.url !== 'string') {
        throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      }
      const connectedPort = Number(body.localPort ?? new URL(body.url).port)
      rememberRemotePort(remote.name, connectedPort)
      environmentWarmBackoff.delete(remote.name)
      return { ...body, localPort: connectedPort }
    }

    async function warmEnvironmentConnections(remotes) {
      if (environmentWarmPromise || environmentState.currentRemote) return environmentWarmPromise
      const now = Date.now()
      const pending = remotes.filter(remote => !remote.connected
        && now >= (environmentWarmBackoff.get(remote.name)?.nextAttemptAt ?? 0))
      if (pending.length === 0) return undefined
      environmentWarmPromise = Promise.allSettled(pending.map(async (remote) => {
        const connected = await requestRemoteConnection(remote)
        return { name: remote.name, connected }
      })).then((results) => {
        const warmed = new Map()
        for (const [index, result] of results.entries()) {
          if (result.status === 'fulfilled') {
            warmed.set(result.value.name, result.value.connected)
            continue
          }
          const name = pending[index].name
          const failures = (environmentWarmBackoff.get(name)?.failures ?? 0) + 1
          environmentWarmBackoff.set(name, {
            failures,
            nextAttemptAt: Date.now() + Math.min(WARM_BACKOFF_BASE_MS * 2 ** failures, WARM_BACKOFF_MAX_MS),
          })
        }
        if (warmed.size > 0) {
          environmentState = {
            ...environmentState,
            remotes: environmentState.remotes.map(remote => {
              const connected = warmed.get(remote.name)
              return connected
                ? { ...remote, connected: true, localPort: connected.localPort, tunnel: { up: true } }
                : remote
            }),
          }
          renderEnvironmentSwitcher()
        }
      }).finally(() => {
        environmentWarmPromise = undefined
      })
      return environmentWarmPromise
    }

    async function navigateToRemoteEnvironment(remote) {
      if (!environmentState.localURL || environmentState.busy) return
      if (remote.connected && Number.isInteger(remote.localPort)) {
        openRemoteEnvironment(remote, `http://127.0.0.1:${String(remote.localPort)}`)
        return
      }
      environmentState = { ...environmentState, busy: remote.name, error: null }
      renderEnvironmentSwitcher()
      try {
        const connected = await requestRemoteConnection(remote)
        openRemoteEnvironment(remote, connected.url)
      } catch (error) {
        environmentState = {
          ...environmentState,
          busy: null,
          error: error instanceof Error ? error.message : String(error),
        }
        renderEnvironmentSwitcher()
      }
    }

    let environmentRenderSignature = ''

    function environmentStateSignature() {
      return JSON.stringify({
        current: environmentState.currentRemote?.name ?? null,
        localURL: environmentState.localURL ?? null,
        busy: environmentState.busy ?? null,
        error: environmentState.error ?? null,
        loading: environmentState.loading,
        remotes: environmentState.remotes.map(remote => [
          remote.name, remote.host ?? null, Boolean(remote.connected),
          Boolean(remote.tunnel?.up), remote.localPort ?? null,
        ]),
      })
    }

    function renderEnvironmentSwitcher() {
      const root = document.querySelector('.gildra-environments')
      renderEnvironmentBadge()
      if (!root) return
      // Пересборка поддерева — childList-мутации, которые будят observer.
      // Пропускаем, когда состояние сред не изменилось с прошлого рендера.
      const signature = environmentStateSignature()
      if (signature === environmentRenderSignature && root.childElementCount > 0) return
      environmentRenderSignature = signature
      root.replaceChildren()
      const localActive = !environmentState.currentRemote
      const local = environmentGroup('Локально')
      local.list.appendChild(makeEnvironmentRow({
        name: 'Этот компьютер',
        detail: environmentState.localURL ? new URL(environmentState.localURL).host : 'Локальный Harness',
        state: localActive ? 'Активно' : 'Готово',
        kind: 'connected',
        active: localActive,
        disabled: localActive || !environmentState.localURL,
        onClick: navigateToLocalEnvironment,
      }))
      root.appendChild(local.group)

      const servers = environmentGroup('Серверы', !environmentState.currentRemote)
      const remoteList = environmentState.remotes
      for (const remote of remoteList) {
        const active = environmentState.currentRemote?.name === remote.name
        const status = environmentStateText(remote, active)
        servers.list.appendChild(makeEnvironmentRow({
          name: remote.name,
          detail: remote.host || 'Удалённая среда',
          state: status,
          kind: environmentState.busy === remote.name
            ? 'connecting'
            : active || remote.connected || remote.tunnel?.up
              ? 'connected'
              : 'disconnected',
          active,
          disabled: active || environmentState.busy === remote.name,
          onClick: () => void navigateToRemoteEnvironment(remote),
        }))
      }
      if (remoteList.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'gildra-environment-empty'
        empty.textContent = environmentState.loading
          ? 'Проверяю подключения…'
          : 'Серверы пока не настроены.'
        servers.list.appendChild(empty)
      }
      if (environmentState.error) {
        const error = document.createElement('p')
        error.className = 'gildra-environment-empty'
        error.textContent = `SSH: ${environmentState.error}`
        servers.list.appendChild(error)
      }
      root.appendChild(servers.group)
      window.requestAnimationFrame(syncEnvironmentPlacement)
    }

    function renderEnvironmentBadge() {
      const remote = environmentState.currentRemote
      // Функция вызывается на каждом проходе observer-конвейера, поэтому все
      // записи идут через идемпотентные помощники — см. блок setText выше.
      setTitle(remote
        ? `Gildra DSH — Сервер ${remote.name}`
        : 'Gildra DSH — Локально')
      const brand = document.querySelector('[data-slot="sidebar.brand.name"]')
      if (!brand) return
      let badge = brand.querySelector('.gildra-brand-environment')
      if (!badge) {
        badge = document.createElement('span')
        badge.className = 'gildra-brand-environment'
        brand.appendChild(badge)
      }
      setDataset(badge, 'kind', remote ? 'remote' : 'local')
      setText(badge, remote ? 'Сервер' : 'Локально')
      setAttr(badge, 'title', remote
        ? `Активная среда: сервер ${remote.name}${remote.host ? ` (${remote.host})` : ''}`
        : 'Активная среда: этот компьютер')
    }

    function ensureCollapsedEnvironmentIndicator() {
      let indicator = document.querySelector('.gildra-collapsed-environment')
      if (!indicator) {
        indicator = document.createElement('button')
        indicator.type = 'button'
        indicator.className = 'gildra-collapsed-environment'
        indicator.addEventListener('click', () => {
          const trigger = [...document.querySelectorAll('button')].find((button) => {
            const label = button.getAttribute('aria-label') ?? button.textContent?.trim()
            return ['Открыть панель', 'Open sidebar', '打开侧边栏'].includes(label)
          })
          trigger?.click()
        })
        document.body.appendChild(indicator)
      }
      const remote = environmentState.currentRemote
      setText(indicator, remote ? `Сервер · ${remote.name}` : '')
      setAttr(indicator, 'aria-label', remote
        ? `Сервер ${remote.name}. Открыть список сред`
        : 'Открыть список сред')
      return indicator
    }

    async function refreshEnvironmentState(force = false) {
      const now = Date.now()
      if (!force && environmentRefreshPromise) return environmentRefreshPromise
      if (!force && now - environmentLastRefresh < 4000) return undefined
      environmentLastRefresh = now
      environmentRefreshPromise = (async () => {
        const localURL = await resolveLocalHarnessURL()
        const currentRemote = currentRemoteContext(localURL)
        if (currentRemote) persistEnvironmentSession(currentRemote)
        let remotes = currentRemote?.fleet ?? []
        let error = null
        if (!currentRemote) {
          try {
            const response = await fetch(SSH_REMOTES_ENDPOINT, { cache: 'no-store' })
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.ok !== true || !Array.isArray(body.remotes)) {
              throw new Error(body.error ?? `HTTP ${String(response.status)}`)
            }
            remotes = body.remotes
            for (const remote of remotes) rememberRemotePort(remote.name, remote.localPort)
            void warmEnvironmentConnections(remotes)
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
          }
        }
        environmentState = {
          ...environmentState,
          loading: false,
          localURL,
          currentRemote,
          remotes: currentRemote && !remotes.some(remote => remote.name === currentRemote.name)
            ? [...remotes, {
                name: currentRemote.name,
                host: currentRemote.host,
                localPort: Number(window.location.port),
                connected: true,
                tunnel: { up: true },
              }]
            : remotes,
          error,
        }
        renderEnvironmentSwitcher()
      })().finally(() => {
        environmentRefreshPromise = undefined
      })
      return environmentRefreshPromise
    }

    function syncEnvironmentPlacement() {
      const root = document.querySelector('.gildra-environments')
      const workspaces = document.querySelector('[data-slot="sidebar.workspaces"]')
      const content = workspaces?.firstElementChild
      if (!root || !workspaces || !(content instanceof HTMLElement)) return
      const rect = content.getBoundingClientRect()
      const collapsed = rect.width < 140
      const indicator = ensureCollapsedEnvironmentIndicator()
      setHidden(root, collapsed)
      setHidden(indicator, !collapsed || !environmentState.currentRemote)
      setClass(content, 'gildra-workspaces-with-environments', !collapsed)
      if (collapsed) {
        removeStyleProperty(content, '--gildra-environment-space')
        return
      }
      setStyleProperty(root, 'left', `${String(Math.round(rect.left))}px`)
      setStyleProperty(root, 'top', `${String(Math.round(rect.top))}px`)
      setStyleProperty(root, 'width', `${String(Math.round(rect.width))}px`)
      setStyleProperty(content, '--gildra-environment-space', `${String(Math.ceil(root.getBoundingClientRect().height + 8))}px`)
    }

    function ensureEnvironmentSwitcher() {
      renderEnvironmentBadge()
      ensureCollapsedEnvironmentIndicator()
      for (const button of document.querySelectorAll('button')) {
        const label = button.getAttribute('aria-label') ?? button.textContent?.trim()
        if (['Сервер SSH', 'SSH Remote', 'SSH 远端'].includes(label)) {
          button.classList.add('gildra-legacy-ssh-trigger')
        }
      }
      if (document.querySelector('.gildra-environments')) {
        syncEnvironmentPlacement()
        return
      }
      const workspaces = document.querySelector('[data-slot="sidebar.workspaces"]')
      if (!workspaces) return
      const root = document.createElement('div')
      root.className = 'gildra-environments'
      root.setAttribute('aria-label', 'Среды выполнения')
      document.body.appendChild(root)
      renderEnvironmentSwitcher()
      syncEnvironmentPlacement()
      void refreshEnvironmentState(true)
    }

