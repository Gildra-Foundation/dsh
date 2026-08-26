    // --- Идемпотентные записи в DOM ------------------------------------
    // Конвейер оверлея перезапускается MutationObserver'ом (childList +
    // characterData), а спецификация ставит mutation record даже при записи
    // прежнего значения. Безусловный `textContent =` в функции, которую
    // конвейер вызывает на каждом проходе, превращается в вечную петлю
    // observer → rAF → рендер → observer. Поэтому все повторяющиеся
    // render*/translate*-функции пишут в DOM только через эти помощники:
    // запись происходит лишь при фактическом изменении значения.
    function setText(node, value) {
      if (node && node.textContent !== value) node.textContent = value
    }

    function setNodeValue(node, value) {
      if (node && node.nodeValue !== value) node.nodeValue = value
    }

    function applyTranslatedNodeValue(node, translated) {
      if (!translated) return
      setNodeValue(node, node.nodeValue.replace(node.nodeValue.trim(), translated))
    }

    function setAttr(node, name, value) {
      if (!node) return
      if (value === null || value === undefined) {
        if (node.hasAttribute(name)) node.removeAttribute(name)
        return
      }
      if (node.getAttribute(name) !== value) node.setAttribute(name, value)
    }

    function setDataset(node, key, value) {
      if (node && node.dataset[key] !== value) node.dataset[key] = value
    }

    function setClass(node, className, present) {
      if (node && node.classList.contains(className) !== present) {
        node.classList.toggle(className, present)
      }
    }

    function setHidden(node, value) {
      if (node && node.hidden !== value) node.hidden = value
    }

    function setStyleProperty(node, property, value) {
      if (node && node.style.getPropertyValue(property) !== value) {
        node.style.setProperty(property, value)
      }
    }

    function removeStyleProperty(node, property) {
      if (node && node.style.getPropertyValue(property) !== '') node.style.removeProperty(property)
    }

    function setTitle(value) {
      if (document.title !== value) document.title = value
    }

