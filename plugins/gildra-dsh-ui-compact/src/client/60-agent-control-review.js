    async function agentControl(force = false) {
      if (force) agentControlPromise = undefined
      agentControlPromise ??= fetch(AGENT_CONTROL_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.ok !== true || typeof body.review !== 'object') {
          throw new Error(body.error ?? `HTTP ${String(response.status)}`)
        }
        return body.review
      }).catch((error) => {
        agentControlPromise = undefined
        throw error
      })
      return agentControlPromise
    }

    async function agentModelCatalog(ctx, force = false) {
      const sessionId = ctx.sessions.list.getSnapshot().current
      const key = sessionId ?? 'global'
      if (force) agentModelCatalogPromises.delete(key)
      if (!agentModelCatalogPromises.has(key)) {
        const request = sessionId
          ? ctx.modelDirectories.directoryFor(sessionId).load().then((catalog) => {
            const provider = catalog.current?.provider
            return provider
              ? { ...catalog, groups: catalog.groups.filter(group => group.id === provider) }
              : catalog
          })
          : ctx.connection.api.llm.models({}).then(({ result }) => {
            if (!result.ok) throw new Error(result.error.message)
            return result.value
          })
        agentModelCatalogPromises.set(key, request.catch((error) => {
          agentModelCatalogPromises.delete(key)
          throw error
        }))
      }
      return agentModelCatalogPromises.get(key)
    }

    function populateReviewModelSelect(select, catalog, reviewerModel) {
      select.replaceChildren()
      const inherit = document.createElement('option')
      inherit.value = ''
      inherit.textContent = 'Как у основного агента'
      select.appendChild(inherit)
      for (const group of catalog.groups) {
        const optionGroup = document.createElement('optgroup')
        optionGroup.label = group.name
        for (const model of group.models) {
          const option = document.createElement('option')
          option.value = model.id
          option.textContent = `${model.name} · ${group.name}`
          optionGroup.appendChild(option)
        }
        select.appendChild(optionGroup)
      }
      if (reviewerModel && ![...select.options].some(option => option.value === reviewerModel)) {
        const saved = document.createElement('option')
        saved.value = reviewerModel
        saved.textContent = `${reviewerModel} · сохранённая модель`
        select.appendChild(saved)
      }
      select.value = reviewerModel ?? ''
      select.disabled = false
    }

    function syncReviewModelSurfaces(reviewerModel, message, kind = '', disabled = false) {
      for (const select of document.querySelectorAll('.gildra-review-model-select')) {
        if ([...select.options].some(option => option.value === (reviewerModel ?? ''))) {
          select.value = reviewerModel ?? ''
        }
        select.disabled = disabled
        select.dataset.kind = kind
        select.title = message
      }
      for (const status of document.querySelectorAll('.gildra-review-model-status')) {
        status.textContent = message
        status.dataset.kind = kind
      }
    }

    async function saveReviewModel(reviewerModel) {
      const response = await fetch(AGENT_CONTROL_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-gildra-action': 'save-agent-control',
        },
        body: JSON.stringify({ reviewerModel: reviewerModel || null }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok !== true || typeof body.review !== 'object') {
        throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      }
      agentControlPromise = Promise.resolve(body.review)
      return body.review
    }

    function wireReviewModelSelect(ctx, select, status) {
      select.disabled = true
      Promise.all([agentControl(), agentModelCatalog(ctx)]).then(([review, catalog]) => {
        populateReviewModelSelect(select, catalog, review.reviewerModel)
        status.textContent = review.reviewerModel
          ? 'Эта модель проверит следующие запросы на действия.'
          : 'Ревью наследует модель основной сессии.'
      }).catch((error) => {
        select.disabled = true
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      })
      select.addEventListener('change', async () => {
        const requested = select.value
        const previous = (await agentControl().catch(() => ({ reviewerModel: null }))).reviewerModel ?? ''
        syncReviewModelSurfaces(previous || null, 'Сохраняю модель ревью…', '', true)
        try {
          const review = await saveReviewModel(requested)
          syncReviewModelSurfaces(
            review.reviewerModel,
            review.reviewerModel
              ? 'Модель применится к следующим проверкам.'
              : 'Ревью снова наследует модель основной сессии.',
            'success',
          )
        } catch (error) {
          syncReviewModelSurfaces(previous || null, error instanceof Error ? error.message : String(error), 'error')
        }
      })
    }

