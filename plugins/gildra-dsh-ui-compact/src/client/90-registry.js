    function registerRussianPluginDictionaries(ctx) {
      for (const [namespace, dictionary] of Object.entries(PLUGIN_RU_DICTIONARIES)) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(namespace, 'ru', dictionary)
          } catch {
            return undefined
          }
        }, `gildra-ui-compact: Russian dictionary ${namespace}`)
      }
    }

    const OVERLAY_FEATURES = Object.freeze([
      {
        id: 'locale',
        enhance(ctx) {
          ensureLanguageChoice(ctx)
          applySettingsFallbackTranslations()
        },
      },
      {
        id: 'agents',
        enhance(ctx) {
          applyTeamTranslations()
          ensurePresetStudioEntry(ctx)
          ensureAgentCenter(ctx)
          ensureReviewPanelModelControl(ctx)
        },
      },
      {
        id: 'context-doctor',
        enhance() {
          applyContextDoctorTranslations()
        },
      },
      {
        id: 'developer-tools',
        enhance(ctx) {
          applyBrandHeadline()
          ensureEnvironmentSwitcher()
          applyCodeMapTranslations()
          applyGitHubTranslations()
          applyWorkspaceFilesTranslations()
          ensureNativeWorkspacePicker(ctx)
          ensureRepositoryEntry(ctx)
          ensureUpdateEntry()
        },
      },
      {
        id: 'plugins',
        enhance() {
          applyAgentSyncTranslations()
          applyManagedPluginInventoryTranslations()
          applyTerminalTranslations()
          applySystemMonitorTranslations()
          applySshRemoteTranslations()
        },
      },
      {
        id: 'automations',
        enhance() {
          applyAutomationTranslations()
          ensureAutomationQuickstart()
        },
      },
      {
        id: 'workspaces',
        enhance() {
          // Панель Workspaces рендерится внутри переключателя сред; данные
          // приходят из Gildra Runtime и обновляются собственным интервалом.
          renderEnvironmentSwitcher()
        },
      },
    ])

    function applyUiEnhancements(ctx) {
      updateRussianUiPreference(ctx)
      for (const feature of OVERLAY_FEATURES) feature.enhance(ctx)
    }

    function connectDesktopHost() {
      const host = window.gildraHost
      if (!host || typeof host.call !== 'function') {
        document.documentElement.dataset.gildraHost = 'web'
        return Promise.resolve(undefined)
      }
      return host.call('host.capabilities').then((capabilities) => {
        if (capabilities?.rpc?.version !== 1) throw new Error('Unsupported Gildra Host RPC version')
        document.documentElement.dataset.gildraHost = 'native'
        window.dispatchEvent(new CustomEvent('gildra-host-ready', { detail: capabilities }))
        return capabilities
      }).catch((error) => {
        document.documentElement.dataset.gildraHost = 'unavailable'
        console.warn('[Gildra] Desktop Host RPC недоступен:', error)
        return undefined
      })
    }

    function handleAutomationEntry(event) {
      const entry = event.target instanceof Element
        ? event.target.closest('[data-dsh-automation-entry]')
        : null
      if (!entry) return
      const tab = [...document.querySelectorAll(SELECTORS.tabs)]
        .find((candidate) => ['Automations', 'Автоматизации'].includes(candidate.textContent?.trim()))
      if (!(tab instanceof HTMLElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      tab.click()
      // Узлом владеет React-рендерер Harness: физическое удаление приводит к
      // NotFoundError при реконсиляции, поэтому элемент только скрывается.
      document.querySelector(SELECTORS.automations.sidebarFeedback)?.classList.add('gildra-suppressed')
    }

    function apply(ctx) {
      registerRussianPluginDictionaries(ctx)

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
        applyUiEnhancements(ctx)
        let frame = 0
        const observer = new MutationObserver(() => {
          window.cancelAnimationFrame(frame)
          frame = window.requestAnimationFrame(() => applyUiEnhancements(ctx))
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          // Переводимые атрибуты тоже наблюдаются: без этого upstream-смена
          // только placeholder/aria-label/title оставалась бы непереведённой
          // до страховочного прохода. Петли нет: setAttr пишет лишь при
          // фактическом изменении значения.
          attributes: true,
          attributeFilter: ['placeholder', 'aria-label', 'title'],
        })
        return () => {
          window.cancelAnimationFrame(frame)
          observer.disconnect()
        }
      }, 'gildra-ui-compact: interface enhancements')

      ctx.effect(() => {
        void connectDesktopHost()
      }, 'gildra-ui-compact: desktop host bridge')

      ctx.effect(() => ctx.locale.subscribe(() => applyUiEnhancements(ctx)), 'gildra-ui-compact: locale changes')

      ctx.effect(() => {
        syncPresetModels(ctx)
        const stopList = ctx.sessions.list.subscribe(() => syncPresetModels(ctx))
        const stopPreset = ctx.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
          presetModelsApplied.delete(sessionId)
          void applyPresetModel(ctx, sessionId, agentPreset).catch((error) => {
            console.warn('[Gildra] Не удалось переключить модель пресета:', error)
          })
        })
        return () => {
          stopList()
          stopPreset()
          presetModelsApplied.clear()
        }
      }, 'gildra-ui-compact: preset model switching')

      ctx.effect(() => {
        // Основной канал перевода — MutationObserver конвейера: те же
        // translate-функции входят в OVERLAY_FEATURES и выполняются при любых
        // изменениях DOM и наблюдаемых атрибутов. Прежний 500-мс интервал
        // полностью дублировал observer и гонял 12 полных проходов по DOM в
        // секунду даже в idle. Остался только редкий страховочный проход для
        // состояний, которых observer не видит; писать в DOM в idle он не
        // будет благодаря идемпотентным помощникам.
        const timer = window.setInterval(() => applyUiEnhancements(ctx), 30000)
        return () => window.clearInterval(timer)
      }, 'gildra-ui-compact: translation fallback sweep')

      ctx.effect(() => {
        const timer = window.setInterval(() => void refreshEnvironmentState(), 8000)
        return () => window.clearInterval(timer)
      }, 'gildra-ui-compact: environment status refresh')

      ctx.effect(() => {
        void refreshRuntimeUi()
        const refreshTimer = window.setInterval(() => void refreshRuntimeUi(), 10000)
        // Heartbeat живых сессий этого окна: пока вкладка открыта, lease не
        // протухает; закрытая вкладка перестаёт биться, и recovery-скан
        // корректно пометит брошенную сессию ORPHANED.
        const heartbeatTimer = window.setInterval(() => void runHeartbeats(), 30000)
        return () => {
          window.clearInterval(refreshTimer)
          window.clearInterval(heartbeatTimer)
        }
      }, 'gildra-ui-compact: workspaces panel refresh')

      ctx.effect(() => {
        document.addEventListener('click', handleAutomationEntry, true)
        return () => {
          document.removeEventListener('click', handleAutomationEntry, true)
        }
      }, 'gildra-ui-compact: automation navigation')
    }

    exports.apply = apply
    exports.inject = ['locale', 'connection', 'sessions', 'remote', 'modelDirectories', 'workspaces']
    // Только для тестов: идемпотентные DOM-помощники проверяются поведенчески
    // (см. test.mjs) без браузера. На runtime-поведение не влияет.
    exports.__testables = {
      applyTranslatedNodeValue,
      removeStyleProperty,
      setAttr,
      setClass,
      setDataset,
      setHidden,
      setNodeValue,
      setStyleProperty,
      setText,
      setTitle,
    }
    return module.exports
  },
})
