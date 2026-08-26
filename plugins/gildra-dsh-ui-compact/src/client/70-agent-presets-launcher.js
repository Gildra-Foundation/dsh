    function slugifyPresetId(value) {
      const transliterated = value.replace(/[А-Яа-яЁё]/g, (letter) => ({
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
        и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
        с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
        щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
      })[letter.toLocaleLowerCase('ru-RU')] ?? '')
      return transliterated
        .toLocaleLowerCase('ru-RU')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
    }

    async function presetMappings(force = false) {
      if (force) presetMappingsPromise = undefined
      presetMappingsPromise ??= fetch(PRESET_STUDIO_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.ok !== true || !Array.isArray(body.presets)) {
          throw new Error(body.error ?? `HTTP ${String(response.status)}`)
        }
        return new Map(body.presets.map(preset => [preset.id, preset]))
      }).catch((error) => {
        presetMappingsPromise = undefined
        throw error
      })
      return presetMappingsPromise
    }

    async function applyPresetModel(ctx, sessionId, presetId) {
      const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
      if (summary?.blank !== true) return
      const mapping = (await presetMappings()).get(presetId)
      if (!mapping) {
        presetModelsApplied.delete(sessionId)
        return
      }
      const key = `${presetId}:${mapping.provider}:${mapping.model}:${mapping.reasoningEffort ?? ''}`
      if (presetModelsApplied.get(sessionId) === key) return
      const latest = ctx.sessions.list.getSnapshot().byId[sessionId]
      if (latest?.blank !== true || latest.agentPreset !== presetId) return
      await ctx.modelDirectories.directoryFor(sessionId).select({
        provider: mapping.provider,
        model: mapping.model,
        ...(mapping.reasoningEffort ? { reasoningEffort: mapping.reasoningEffort } : {}),
      })
      presetModelsApplied.set(sessionId, key)
    }

    function syncPresetModels(ctx) {
      const snapshot = ctx.sessions.list.getSnapshot()
      for (const id of snapshot.ids) {
        const session = snapshot.byId[id]
        if (session?.blank !== true || !session.agentPreset) {
          presetModelsApplied.delete(id)
          continue
        }
        void applyPresetModel(ctx, id, session.agentPreset).catch((error) => {
          console.warn('[Gildra] Не удалось применить модель пресета:', error)
        })
      }
    }

    function selectedModel(select, catalog) {
      let provider = ''
      let model = ''
      try {
        [provider, model] = JSON.parse(select.value)
      } catch {
        // An empty or stale option is rejected by the Host-side validation.
      }
      const group = catalog.groups.find(candidate => candidate.id === provider)
      const row = group?.models.find(candidate => candidate.id === model)
      return { provider, model, row }
    }

    function fillEfforts(modelSelect, effortSelect, catalog) {
      const { row } = selectedModel(modelSelect, catalog)
      effortSelect.replaceChildren()
      const defaultOption = document.createElement('option')
      defaultOption.value = ''
      defaultOption.textContent = 'По умолчанию модели'
      effortSelect.appendChild(defaultOption)
      for (const effort of row?.reasoning?.efforts ?? []) {
        const option = document.createElement('option')
        option.value = effort.id
        option.textContent = effort.name
        effortSelect.appendChild(option)
      }
      effortSelect.value = row?.reasoning?.defaultEffort ?? ''
      effortSelect.disabled = (row?.reasoning?.efforts?.length ?? 0) === 0
    }

    async function loadModelCatalog(ctx, modelSelect, effortSelect, status) {
      const { result } = await ctx.connection.api.llm.models({})
      if (!result.ok) throw new Error(result.error.message)
      const catalog = result.value
      modelSelect.replaceChildren()
      for (const group of catalog.groups) {
        const optionGroup = document.createElement('optgroup')
        optionGroup.label = group.name
        for (const model of group.models) {
          const option = document.createElement('option')
          option.value = JSON.stringify([group.id, model.id])
          option.textContent = `${model.name} · ${group.name}`
          optionGroup.appendChild(option)
        }
        modelSelect.appendChild(optionGroup)
      }
      if (modelSelect.options.length === 0) throw new Error('Нет доступных моделей. Сначала настройте провайдера в разделе «Модели».')
      const preferredValue = JSON.stringify(['codex', 'gpt-5.6-sol'])
      const preferred = [...modelSelect.options].find(option => option.value === preferredValue)
      if (preferred) modelSelect.value = preferred.value
      fillEfforts(modelSelect, effortSelect, catalog)
      modelSelect.addEventListener('change', () => fillEfforts(modelSelect, effortSelect, catalog))
      status.textContent = catalog.failures.length === 0
        ? 'Пресет получит инженерные инструменты, а выбранная модель будет применяться при его включении.'
        : `Часть каталогов моделей недоступна: ${catalog.failures.map(row => row.name).join(', ')}`
      return catalog
    }

    async function loadLauncherCatalog(ctx, modelSelect, effortSelect, status) {
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (!sessionId) throw new Error('Сначала выберите проект и создайте сессию.')
      const catalog = await ctx.modelDirectories.directoryFor(sessionId).load()
      const currentProvider = catalog.current?.provider
      const groups = currentProvider
        ? catalog.groups.filter(group => group.id === currentProvider)
        : catalog.groups
      const scoped = { ...catalog, groups }
      modelSelect.replaceChildren()
      const inherit = document.createElement('option')
      inherit.value = ''
      inherit.textContent = 'Как у основного агента'
      modelSelect.appendChild(inherit)
      for (const group of groups) {
        const optionGroup = document.createElement('optgroup')
        optionGroup.label = group.name
        for (const model of group.models) {
          const option = document.createElement('option')
          option.value = JSON.stringify([group.id, model.id])
          option.textContent = model.name
          optionGroup.appendChild(option)
        }
        modelSelect.appendChild(optionGroup)
      }
      modelSelect.value = ''
      modelSelect.disabled = false
      fillEfforts(modelSelect, effortSelect, scoped)
      modelSelect.addEventListener('change', () => fillEfforts(modelSelect, effortSelect, scoped))
      status.textContent = currentProvider
        ? 'Показаны модели текущего провайдера. Можно оставить модель основной сессии.'
        : 'Выберите модель участника или оставьте наследование.'
      return scoped
    }

    function openAgentLauncher(ctx) {
      document.querySelector('.gildra-agent-launcher-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-preset-studio-backdrop gildra-agent-launcher-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-preset-studio-dialog gildra-agent-launcher-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-agent-launcher-title')
      dialog.innerHTML = `
        <header class="gildra-preset-studio-head">
          <div>
            <h2 id="gildra-agent-launcher-title">Новый сабагент</h2>
            <p>Подготовьте участника команды с собственной ролью, задачей и моделью. Запуск останется в вашем запросе до отправки.</p>
          </div>
          <button class="gildra-preset-studio-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <form class="gildra-preset-studio-form gildra-agent-launcher-form">
          <label class="gildra-preset-field">
            Имя участника
            <input name="name" maxlength="48" required value="Исследователь" autocomplete="off">
          </label>
          <label class="gildra-preset-field">
            Роль
            <input name="role" maxlength="80" required value="исследователь кодовой базы" autocomplete="off">
          </label>
          <label class="gildra-preset-field">
            Связь с командой
            <select name="relation">
              <option value="managed">Управляемый — общается с главным агентом</option>
              <option value="peer">Равноправный — общается со всей командой</option>
            </select>
          </label>
          <label class="gildra-preset-field">
            Модель
            <select name="model" disabled><option>Загрузка моделей…</option></select>
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Глубина рассуждения
            <select name="effort" disabled><option value="">По умолчанию модели</option></select>
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Первая задача
            <textarea name="task" maxlength="12000" required placeholder="Например: изучи модуль авторизации, найди причину сбоя и верни главному агенту доказательства и минимальный план исправления."></textarea>
          </label>
          <p class="gildra-preset-studio-status" role="status">Загружаю модели текущей сессии…</p>
          <div class="gildra-preset-studio-actions">
            <button type="button" data-cancel>Отмена</button>
            <button type="submit" disabled>Добавить в запрос</button>
          </div>
        </form>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)
      const form = dialog.querySelector('form')
      const model = form.elements.namedItem('model')
      const effort = form.elements.namedItem('effort')
      const status = form.querySelector('[role="status"]')
      const submit = form.querySelector('button[type="submit"]')
      let catalog
      const close = () => {
        document.removeEventListener('keydown', onKey)
        backdrop.remove()
        void agentControl().then((review) => {
          syncReviewModelSurfaces(
            review.reviewerModel,
            review.reviewerModel
              ? 'Эта модель проверит следующие запросы на действия.'
              : 'Ревью наследует модель основной сессии.',
          )
        }).catch(() => {})
      }
      const onKey = event => { if (event.key === 'Escape') close() }
      dialog.querySelector('.gildra-preset-studio-close').addEventListener('click', close)
      form.querySelector('[data-cancel]').addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      document.addEventListener('keydown', onKey)
      form.elements.namedItem('task').focus()

      void loadLauncherCatalog(ctx, model, effort, status).then((value) => {
        catalog = value
        submit.disabled = false
      }).catch((error) => {
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      })

      form.addEventListener('submit', (event) => {
        event.preventDefault()
        if (!form.reportValidity() || !catalog) return
        const composer = [...document.querySelectorAll('[data-composer-seat] textarea')]
          .find(element => !element.disabled && !element.readOnly && element.offsetParent !== null)
        if (!(composer instanceof HTMLTextAreaElement)) {
          status.dataset.kind = 'error'
          status.textContent = 'Сначала выберите проект и откройте доступную для ввода сессию.'
          return
        }
        const selection = selectedModel(model, catalog)
        const relation = form.elements.namedItem('relation').value
        const relationLabel = relation === 'peer' ? 'peer' : 'managed'
        const lines = [
          'Создай участника команды через штатный инструмент team_spawn со следующими параметрами:',
          `- name: ${form.elements.namedItem('name').value.trim()}`,
          `- role: ${form.elements.namedItem('role').value.trim()}`,
          `- relation: ${relationLabel}`,
          selection.model ? `- model: ${selection.model}` : '- model: наследовать модель основной сессии',
          effort.value ? `- reasoning_effort: ${effort.value}` : '- reasoning_effort: по умолчанию модели',
          '',
          'Первая самостоятельная задача:',
          form.elements.namedItem('task').value.trim(),
          '',
          'После успешного запуска продолжай свою часть работы параллельно; результаты участника принимай через комнату команды.',
        ]
        const prompt = lines.join('\n')
        setControlledValue(composer, composer.value.trim() ? `${composer.value.trimEnd()}\n\n${prompt}` : prompt)
        close()
        composer.focus()
      })
    }

