export const name = 'gildra-ui-compact'
export const inject = ['systemPrompt', 'tools']

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:code-map',
    order: 115,
    text: 'When Archify produces a validated HTML diagram, immediately call canvas_preview with mode=render and the local file path so the result appears in the Code Map tab. For an architecture example use examples/web-app.architecture.json from the loaded Archify skill; do not guess a generic examples/architecture.json path. Use canvas_preview file or html input only; never use its url input. Tell the user to open the Code Map tab after the preview succeeds.',
  }), 'gildra-ui-compact: code map guidance')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:tool-hygiene',
    order: 116,
    text: 'Tool-call hygiene: do not send sandbox_permissions when the requested mode equals the session current permission mode. Include sandbox_permissions only for a strictly broader escalation. Whenever a tool accepts justification, provide a non-empty complete sentence that explains why the escalation is necessary.',
  }), 'gildra-ui-compact: tool-call hygiene')

  ctx.effect(() => ctx.tools.guard((exec) => {
    if (exec.name !== 'canvas_preview') return undefined
    const args = exec.arguments
    if (args && typeof args === 'object' && typeof args.url === 'string' && args.url.trim()) {
      return 'Remote URL preview is disabled in Gildra DSH. Fetch the page with web_fetch or save a reviewed HTML file inside the workspace, then preview that local file.'
    }
    return undefined
  }), 'gildra-ui-compact: block remote canvas fetch')
}
