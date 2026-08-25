window.__ModuleLoader__.load({
  id: '@gildra/dsh-ui-compact',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const CSS = `
      [data-context-doctor] > button {
        min-height: 27px !important;
        width: 31px !important;
        padding: 3px 6px !important;
        gap: 3px !important;
        justify-content: center !important;
        border-radius: 7px !important;
        font-size: 11px !important;
        cursor: default !important;
      }
      [data-context-doctor] > button > span:nth-child(2) {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
      [data-context-doctor] > button > span:last-child {
        width: 6px !important;
        height: 6px !important;
        margin-left: -2px !important;
        align-self: flex-end !important;
      }
      [data-context-doctor] > section[role="dialog"] {
        display: none !important;
      }
    `

    function apply(ctx) {
      ctx.effect(() => {
        const previous = document.querySelector('style[data-gildra-ui-compact]')
        previous?.remove()
        const style = document.createElement('style')
        style.dataset.gildraUiCompact = 'true'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'gildra-ui-compact: styles')
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
