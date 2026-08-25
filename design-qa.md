# Design QA: Gildra Coding headline and compact Context Doctor

## Evidence

- Source visual truth: `/var/folders/0n/g1rt2g1923z67thj34qs8zb40000gn/T/codex-clipboard-3be21655-c74f-42cc-8095-1eec67a16f51.png`
- Rendered desktop implementation: `implementation-gildra-coding-app.png`
- Context Doctor open state: `implementation-context-doctor-open.png`
- Full-view comparison: `design-qa-comparison-full.png`
- Focused headline comparison: `design-qa-comparison.png`
- Source pixels: 1968 × 946; source density is not encoded in the supplied screenshot.
- Implementation pixels: 2400 × 1600 at a 1200 × 800 CSS window and 2× macOS display density.
- Browser interaction check: 487 × 743 CSS viewport.
- State: dark theme, ParserUnix workspace, Engineering preset, empty/new session composer.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Copy: the requested `Into the Unknown` headline is replaced with `Gildra Coding`; `Preview` and the existing logo remain unchanged.
- Fonts and typography: the existing DSH headline font, weight, line height, and antialiasing are preserved.
- Spacing and layout rhythm: the shorter headline contracts naturally while retaining the original logo/title/badge alignment.
- Colors and visual tokens: no changes; the existing dark theme and badge tokens are preserved.
- Image and asset fidelity: the original DSH logo and icons are reused; no replacement or approximate assets were introduced.
- Context Doctor: the 31 × 27 px trigger opens and closes normally. The desktop panel is capped at 320 × 420 px; at narrow widths it is 290 px wide and centered above the trigger so it stays on-screen.

## Comparison history

1. The first compact-panel revision disabled the dialog entirely. This was a P1 interaction regression.
2. The dialog was restored and limited to 320 × 420 px.
3. The narrow layout initially anchored the 290 px dialog off-screen. It was re-anchored above the trigger and verified in both open and closed states.

## Implementation checklist

- [x] Replace the hero headline without changing DSH core files.
- [x] Preserve the logo, Preview badge, theme, and responsive layout.
- [x] Restore Context Doctor click behavior.
- [x] Verify compact panel placement and close behavior.
- [x] Verify the rendered desktop app and focused headline comparison.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Release UI regression: Automations, Context Doctor and server fleet

## Final evidence

- Automations is fully translated and its native close button remains visible and clickable because the optional system monitor is hidden only while the full-screen workspace is active.
- Context Doctor remains compact, opens and closes from its native trigger, and no longer collides with the system monitor. Dynamic counts, statuses and recommendation text are translated.
- The environment panel lists Local, Manacost and Gildra from every origin. A live Manacost → Gildra transition and return to Local completed without restarting the desktop application.
- Terminal restart and a safe `GILDRA_AUDIT_OK` command completed in the installed application.

No actionable P0, P1 or P2 UI regression remains in the audited user journey.

final result: passed

---

# Design QA: Local and remote environments

## Evidence

- Source visual truth: `artifacts/design-qa/reference-codex-sidebar.png`
- Local implementation: `artifacts/design-qa/implementation-local.jpeg`
- Remote implementation: `artifacts/design-qa/implementation-remote.jpeg`
- Focused comparisons: `artifacts/design-qa/compare-local.png`, `artifacts/design-qa/compare-remote.png`
- Source pixels: 532 × 1248.
- Implementation pixels and CSS viewport: 1152 × 768, desktop window, dark theme.
- Focused comparison normalization: the 268 × 768 implementation sidebar was cropped and scaled to 435 × 1248 beside the unscaled 532 × 1248 reference. Density was normalized by equal comparison height; no browser or device frame was included in the crop.
- States: local Harness active; `gildra-server` connected; remote Harness active through the SSH tunnel.

## Full-view comparison

The installed macOS application keeps the native DeepSeek Harness composition: dark sidebar, compact section labels, muted secondary copy, rounded active rows, and green connectivity indicators. The added environment area stays within the existing sidebar and does not change the main composer, footer, or workspace hierarchy.

## Focused region comparison

The Codex reference communicates environment ownership by separating a connected remote group from local project groups. Gildra DSH now makes that distinction more explicit with two named groups, `Локально` and `Серверы`, a persistent active row, and a compact brand badge. The focused comparison confirms consistent hierarchy, dark-surface balance, compact density, truncation behavior, and visible active state.

## Required fidelity surfaces

- Fonts and typography: existing Harness font stack is preserved. Section labels use the product's small uppercase navigation style; names, details, and states remain readable without wrapping.
- Spacing and layout rhythm: the environment panel occupies one compact sidebar block, aligns to the workspace controls, and preserves footer visibility at 1152 × 768.
- Colors and tokens: only existing Harness background, border, business, success, warning, and error tokens are used. Local and remote connectivity use the same semantic green as the product.
- Image and icon fidelity: no new raster assets, handcrafted SVGs, emoji, or approximate icons were introduced. State is communicated with semantic status dots and text.
- Copy and content: `Локально`, `Серверы`, `Этот компьютер`, `Активно`, `Готово`, and `Подключён` clearly identify where the agent is running. The window title also changes between `Gildra DSH — Локально` and `Gildra DSH — Сервер gildra-server`.

## Interaction and runtime checks

- Clicking `gildra-server` restored/used the SSH tunnel and navigated the installed desktop application to `127.0.0.1:55775`.
- The desktop window remained on the remote Harness after a delayed re-check; SwiftUI no longer forced it back to the local service URL.
- Clicking `Этот компьютер` returned the same desktop window to the local Harness on port 3080.
- After explicitly disconnecting the tunnel, clicking `gildra-server` recreated it on the persisted local port 55775. The remote origin stayed stable, so language and browser-side preferences were not requested again.
- The old composer-level SSH trigger is hidden to avoid two competing navigation models.
- Local and remote rendered states were captured from the installed macOS app. Browser DOM snapshots exposed the same buttons and status copy. No blocking page error appeared during the tested transitions.

## Comparison history

1. P1: the desktop representable reloaded its local service URL during SwiftUI updates, making SSH navigation unstable. Fixed by preserving non-local WebView navigation and following a changed service URL only while the previous local service is still displayed. Post-fix evidence: the installed app remained on the remote URL during a delayed state check.
2. P2: the first brand badge competed with the build revision and the connected server dot used a neutral state. Fixed by shortening the badge to `Локально` / `Сервер`, moving the full server name to its row and tooltip, hiding the redundant revision in the compact header, and assigning semantic connection states.
3. P1: direct DOM insertion could be removed by the React sidebar on subsequent navigation. Fixed by mounting the environment panel outside the reconciled subtree and reserving measured space in the native workspace region. The first portal measurement used the zero-sized `display: contents` slot; the final iteration measures its concrete child. Post-fix evidence: both final local and remote screenshots show the panel after a round trip.

## Findings

No actionable P0, P1, or P2 differences remain for the requested local/remote environment workflow.

## Follow-up polish

- P3: when several servers are configured, consider a search field after the list reaches five entries.
- P3: expose the environment rows through a first-party Harness sidebar slot if upstream adds one; the current overlay preserves the native appearance and behavior but owns its measured sidebar reservation.

## Final result

final result: passed

### Fleet and collapsed-sidebar update

- The current server list is `Manacost` (`debian-151`, tunnel `55775`) and `Gildra` (`debian-51`, tunnel `55776`). Both rows rendered as `Подключён` after background prewarming.
- A live local-to-Manacost navigation completed in about 1.3 seconds including page load. A live local-to-Gildra navigation completed in about 0.5 seconds after prewarming; returning to local completed in about 0.1 seconds.
- A stale but still-running SSH tunnel previously looked connected to the plugin while HTTP was unresponsive. The overlay now disconnects that stale process before reconnecting, so a live PID alone is no longer treated as a usable route.
- When the sidebar is collapsed on a remote host, a small `Сервер · Gildra` / `Сервер · Manacost` indicator remains visible. Clicking it opens the environment list. The document title is also maintained as `Gildra DSH — Сервер <name>` without requiring the sidebar to be opened.
- The final tested state was returned to `Gildra DSH — Локально` on port 3080.

final result: passed
