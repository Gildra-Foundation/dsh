    const PRESET_STUDIO_ENDPOINT = '/gildra/agent-presets'
    const REPOSITORY_ENDPOINT = '/gildra/workspaces/clone'
    const UPDATE_ENDPOINT = '/gildra/update'
    const AGENT_CONTROL_ENDPOINT = '/gildra/agent-control'
    const SSH_REMOTES_ENDPOINT = '/ssh-remotes'
    const ENVIRONMENT_SESSION_KEY = 'gildra.environment.v1'
    const ENVIRONMENT_PREFERENCES_KEY = 'gildra.environment.preferences.v1'
    const presetModelsApplied = new Map()
    let presetMappingsPromise
    let agentControlPromise
    const agentModelCatalogPromises = new Map()
    let environmentRefreshPromise
    let environmentWarmPromise
    let environmentLastRefresh = 0
    // Экспоненциальный backoff фонового прогрева SSH: недоступный сервер не
    // должен получать connect/disconnect каждые 8 секунд бесконечно.
    const environmentWarmBackoff = new Map()
    const WARM_BACKOFF_BASE_MS = 8000
    const WARM_BACKOFF_MAX_MS = 300000
    let environmentState = {
      loading: true,
      localURL: null,
      currentRemote: null,
      remotes: [],
      busy: null,
      error: null,
    }

    // --- Gildra Runtime (/gildra/v1): сессии и воркспейсы -----------------
    // Overlay только отображает состояние и шлёт intents; вся orchestration
    // (worktree, lease, merge, cleanup) живёт в серверном @gildra/dsh-runtime.
    const RUNTIME_API = '/gildra/v1'
    const RUNTIME_TOKENS_KEY = 'gildra.runtime.tokens.v1'
    let runtimeUiState = { available: false, projects: [], sessions: [], workspaces: [], notice: null }
    let runtimeRefreshPromise

    function runtimeTokens() {
      try {
        return JSON.parse(window.sessionStorage.getItem(RUNTIME_TOKENS_KEY) ?? '{}') ?? {}
      } catch {
        return {}
      }
    }

    function rememberRuntimeToken(sessionId, ownerToken) {
      try {
        const tokens = runtimeTokens()
        if (ownerToken) tokens[sessionId] = ownerToken
        else delete tokens[sessionId]
        window.sessionStorage.setItem(RUNTIME_TOKENS_KEY, JSON.stringify(tokens))
      } catch {
        // sessionStorage может быть недоступен — управление чужими сессиями
        // просто останется выключенным.
      }
    }

    async function runtimeCall(path, { method = 'GET', body } = {}) {
      const response = await fetch(`${RUNTIME_API}${path}`, {
        method,
        cache: 'no-store',
        ...(body === undefined ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok !== true) {
        const error = new Error(payload?.error?.message ?? `HTTP ${String(response.status)}`)
        error.code = payload?.error?.code ?? 'INTERNAL'
        throw error
      }
      return payload
    }

