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

