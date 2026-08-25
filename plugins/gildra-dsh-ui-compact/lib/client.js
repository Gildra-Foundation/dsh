window.__ModuleLoader__.load({
  id: '@gildra/dsh-ui-compact',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const CSS = `
      .gildra-language-backdrop {
        position: fixed;
        z-index: 8000;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(4, 6, 10, .76);
        backdrop-filter: blur(8px);
      }
      .gildra-language-dialog {
        width: min(520px, 100%);
        box-sizing: border-box;
        padding: 24px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 16px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 28px 90px rgba(0, 0, 0, .62);
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family, system-ui);
      }
      .gildra-language-dialog h1 {
        margin: 0 0 8px;
        font-size: 22px;
        line-height: 28px;
      }
      .gildra-language-dialog > p {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 20px;
      }
      .gildra-language-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 22px;
      }
      .gildra-language-options button {
        min-height: 96px;
        padding: 16px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .gildra-language-options button:hover,
      .gildra-language-options button:focus-visible {
        border-color: var(--dsw-alias-state-business-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 38%, var(--dsw-alias-bg-base));
        outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
        outline-offset: 1px;
      }
      .gildra-language-options strong,
      .gildra-language-options small {
        display: block;
      }
      .gildra-language-options strong {
        margin-bottom: 5px;
        font-size: 17px;
        line-height: 22px;
      }
      .gildra-language-options small {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-language-status {
        min-height: 18px;
        margin-top: 12px !important;
        color: var(--dsw-alias-state-error-primary, #ff6b6b) !important;
        font-size: 12px !important;
      }
      @media (max-width: 520px) {
        .gildra-language-backdrop {
          padding: 10px;
        }
        .gildra-language-dialog {
          padding: 20px;
        }
        .gildra-language-options {
          grid-template-columns: 1fr;
        }
        .gildra-language-options button {
          min-height: 82px;
        }
      }

      [data-context-doctor] > button {
        min-height: 27px !important;
        width: 31px !important;
        padding: 3px 6px !important;
        gap: 3px !important;
        justify-content: center !important;
        border-radius: 7px !important;
        font-size: 11px !important;
        cursor: pointer !important;
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
        width: 320px !important;
        max-width: calc(100vw - 20px) !important;
        max-height: min(52vh, 420px) !important;
        border-radius: 10px !important;
      }
      @media (max-width: 520px) {
        [data-context-doctor] > section[role="dialog"] {
          left: 50% !important;
          right: auto !important;
          transform: translateX(-50%) !important;
          width: 290px !important;
          max-height: min(48vh, 390px) !important;
        }
      }

      body:has(.dsh-automation-shell) .dsh-automation-sidebar-feedback {
        display: none !important;
      }
      .dsh-automation-shell {
        padding-top: 18px !important;
        padding-bottom: 24px !important;
      }
      [data-conversation-scroll]:has(.dsh-automation-shell) > [data-composer-seat] {
        display: none !important;
      }
      .dsh-automation-stats {
        gap: 8px !important;
        margin-bottom: 14px !important;
      }
      .dsh-automation-stats > div {
        min-height: 58px !important;
        padding: 8px 12px !important;
      }
      .dsh-automation-stats > div:nth-child(-n+2) strong {
        font-size: 18px !important;
      }
      .gildra-automation-quickstart {
        max-width: 1440px;
        margin: 0 auto 14px;
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l2));
        border-radius: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 35%, var(--dsw-alias-bg-layer-1));
      }
      .gildra-automation-quickstart strong {
        display: block;
        margin-bottom: 2px;
        font-size: 13px;
      }
      .gildra-automation-quickstart p {
        margin: 0 0 10px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 17px;
      }
      .gildra-automation-template-list {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .gildra-automation-template-list button {
        min-height: 42px;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 9px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 600 11px/16px var(--dsw-font-family, system-ui);
        text-align: left;
        cursor: pointer;
      }
      .gildra-automation-template-list button:hover,
      .gildra-automation-template-list button:focus-visible {
        border-color: var(--dsw-alias-state-business-primary);
        color: var(--dsw-alias-state-business-primary);
        outline: none;
      }
      .dsh-automation-create {
        position: fixed !important;
        z-index: 3000 !important;
        top: 36px !important;
        bottom: 36px !important;
        left: 50% !important;
        width: min(820px, calc(100vw - 48px)) !important;
        max-width: none !important;
        margin: 0 !important;
        overflow: auto !important;
        transform: translateX(-50%) !important;
        background: var(--dsw-alias-bg-layer-1) !important;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .55) !important;
      }
      .dsh-automation-create::before {
        position: fixed;
        z-index: -1;
        inset: -100vh -100vw;
        background: rgba(4, 6, 10, .62);
        content: '';
      }
      .dsh-automation-form-footer {
        position: sticky;
        z-index: 2;
        bottom: -18px;
        padding: 13px 0 16px !important;
        background: var(--dsw-alias-bg-layer-1);
      }
      @media (max-width: 760px) {
        .gildra-automation-template-list {
          grid-template-columns: 1fr;
        }
        .dsh-automation-create {
          top: 8px !important;
          bottom: 8px !important;
          width: calc(100vw - 16px) !important;
          padding: 14px !important;
        }
      }

      .gildra-preset-studio-entry {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        margin: 12px 0 18px;
        padding: 14px 16px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, var(--dsw-alias-border-l2));
        border-radius: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 28%, var(--dsw-alias-bg-layer-1));
      }
      .gildra-preset-studio-entry strong {
        display: block;
        margin-bottom: 3px;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
      }
      .gildra-preset-studio-entry span {
        display: block;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 17px;
      }
      .gildra-preset-studio-entry button,
      .gildra-preset-studio-actions button {
        min-height: 34px;
        padding: 7px 13px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 600 12px/18px var(--dsw-font-family, system-ui);
        white-space: nowrap;
        cursor: pointer;
      }
      .gildra-preset-studio-entry button,
      .gildra-preset-studio-actions button[type="submit"] {
        border-color: var(--dsw-alias-state-business-primary);
        background: var(--dsw-alias-state-business-primary);
        color: white;
      }
      .gildra-preset-studio-entry button:hover,
      .gildra-preset-studio-actions button:hover {
        filter: brightness(1.08);
      }
      .gildra-preset-studio-backdrop {
        position: fixed;
        z-index: 7000;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(4, 6, 10, .7);
      }
      .gildra-preset-studio-dialog {
        width: min(720px, 100%);
        max-height: min(860px, calc(100vh - 48px));
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 28px 90px rgba(0, 0, 0, .62);
      }
      .gildra-preset-studio-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 19px 20px 14px;
        border-bottom: 1px solid var(--dsw-alias-border-l2);
      }
      .gildra-preset-studio-head h2 {
        margin: 0 0 4px;
        color: var(--dsw-alias-label-primary);
        font-size: 18px;
      }
      .gildra-preset-studio-head p {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-preset-studio-close {
        width: 30px;
        min-width: 30px;
        height: 30px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-size: 20px;
        cursor: pointer;
      }
      .gildra-preset-studio-form {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        padding: 18px 20px 20px;
      }
      .gildra-preset-field {
        display: grid;
        gap: 6px;
        color: var(--dsw-alias-label-primary);
        font: 600 11px/16px var(--dsw-font-family, system-ui);
      }
      .gildra-preset-field--wide {
        grid-column: 1 / -1;
      }
      .gildra-preset-field small {
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        font-weight: 400;
      }
      .gildra-preset-field input,
      .gildra-preset-field textarea,
      .gildra-preset-field select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 400 12px/18px var(--dsw-font-family, system-ui);
      }
      .gildra-preset-field input,
      .gildra-preset-field select {
        min-height: 36px;
        padding: 7px 10px;
      }
      .gildra-preset-field textarea {
        min-height: 160px;
        padding: 10px;
        resize: vertical;
      }
      .gildra-preset-field input:focus,
      .gildra-preset-field textarea:focus,
      .gildra-preset-field select:focus {
        border-color: var(--dsw-alias-state-business-primary);
        outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent);
      }
      .gildra-preset-studio-status {
        grid-column: 1 / -1;
        min-height: 18px;
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-preset-studio-status[data-kind="error"] {
        color: var(--dsw-alias-state-error-primary, #ff6b6b);
      }
      .gildra-preset-studio-status[data-kind="success"] {
        color: var(--dsw-alias-state-success-primary, #43c778);
      }
      .gildra-preset-studio-actions {
        grid-column: 1 / -1;
        display: flex;
        justify-content: flex-end;
        gap: 9px;
      }
      .gildra-preset-studio-actions button:disabled {
        cursor: wait;
        opacity: .62;
      }
      @media (max-width: 640px) {
        .gildra-preset-studio-entry {
          align-items: stretch;
          flex-direction: column;
        }
        .gildra-preset-studio-backdrop {
          padding: 8px;
        }
        .gildra-preset-studio-dialog {
          max-height: calc(100vh - 16px);
        }
        .gildra-preset-studio-form {
          grid-template-columns: 1fr;
        }
        .gildra-preset-field--wide,
        .gildra-preset-studio-status,
        .gildra-preset-studio-actions {
          grid-column: 1;
        }
      }

      .gildra-repository-add {
        color: var(--dsw-alias-state-business-primary) !important;
      }
      .gildra-repository-add svg {
        width: 16px;
        height: 16px;
        pointer-events: none;
      }
      .gildra-repository-backdrop {
        position: fixed;
        z-index: 7200;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(4, 6, 10, .72);
      }
      .gildra-repository-dialog {
        width: min(560px, 100%);
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 28px 90px rgba(0, 0, 0, .62);
      }
      .gildra-repository-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 19px 20px 14px;
        border-bottom: 1px solid var(--dsw-alias-border-l2);
      }
      .gildra-repository-head h2 {
        margin: 0 0 5px;
        color: var(--dsw-alias-label-primary);
        font-size: 18px;
      }
      .gildra-repository-head p {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-repository-close {
        width: 30px;
        min-width: 30px;
        height: 30px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-size: 20px;
        cursor: pointer;
      }
      .gildra-repository-form {
        display: grid;
        gap: 14px;
        padding: 18px 20px 20px;
      }
      .gildra-repository-field {
        display: grid;
        gap: 6px;
        color: var(--dsw-alias-label-primary);
        font: 600 11px/16px var(--dsw-font-family, system-ui);
      }
      .gildra-repository-field small {
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        font-weight: 400;
      }
      .gildra-repository-field input {
        width: 100%;
        min-height: 38px;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 400 12px/18px var(--dsw-font-family, system-ui);
      }
      .gildra-repository-field input:focus {
        border-color: var(--dsw-alias-state-business-primary);
        outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent);
      }
      .gildra-repository-status {
        min-height: 18px;
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-repository-status[data-kind="error"] {
        color: var(--dsw-alias-state-error-primary, #ff6b6b);
      }
      .gildra-repository-status[data-kind="success"] {
        color: var(--dsw-alias-state-success-primary, #43c778);
      }
      .gildra-repository-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
      }
      .gildra-repository-actions button {
        min-height: 34px;
        padding: 7px 13px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 600 12px/18px var(--dsw-font-family, system-ui);
        cursor: pointer;
      }
      .gildra-repository-actions button[type="submit"] {
        border-color: var(--dsw-alias-state-business-primary);
        background: var(--dsw-alias-state-business-primary);
        color: white;
      }
      .gildra-repository-actions button:disabled,
      .gildra-repository-close:disabled {
        cursor: wait;
        opacity: .62;
      }
      .gildra-update-sidebar-entry {
        position: relative;
      }
      .gildra-update-sidebar-entry svg {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
      }
      .gildra-update-sidebar-entry[data-update-available="true"]::after {
        position: absolute;
        top: 7px;
        right: 7px;
        width: 7px;
        height: 7px;
        border: 2px solid var(--dsw-alias-bg-layer-1);
        border-radius: 50%;
        background: var(--dsw-alias-state-success-primary, #43c778);
        content: '';
        pointer-events: none;
      }
      .gildra-update-summary {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .gildra-update-version {
        padding: 11px 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 9px;
        background: var(--dsw-alias-bg-base);
      }
      .gildra-update-version small,
      .gildra-update-version strong {
        display: block;
      }
      .gildra-update-version small {
        margin-bottom: 3px;
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
      }
      .gildra-update-version strong {
        color: var(--dsw-alias-label-primary);
        font-size: 15px;
      }
      .gildra-update-notice {
        margin: 0;
        padding: 10px 12px;
        border-radius: 9px;
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 36%, var(--dsw-alias-bg-base));
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .gildra-agent-menu-anchor {
        display: inline-flex;
        align-items: center;
      }
      .gildra-agent-menu-trigger[aria-expanded="true"] {
        color: var(--dsw-alias-state-business-primary) !important;
      }
      .gildra-agent-menu-popover {
        position: fixed;
        z-index: 3800;
        width: min(340px, calc(100vw - 24px));
        box-sizing: border-box;
        padding: 8px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 11px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 18px 55px rgba(0, 0, 0, .46);
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family, system-ui);
      }
      .gildra-agent-menu-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 7px 8px;
      }
      .gildra-agent-menu-head strong,
      .gildra-agent-menu-head span,
      .gildra-agent-menu-action strong,
      .gildra-agent-menu-action span {
        display: block;
      }
      .gildra-agent-menu-head strong,
      .gildra-agent-menu-action strong,
      .gildra-agent-review-head strong {
        font-size: 12px;
        line-height: 17px;
      }
      .gildra-agent-menu-head span,
      .gildra-agent-menu-action span,
      .gildra-agent-review-label small,
      .gildra-review-model-status {
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        line-height: 15px;
      }
      .gildra-agent-menu-close,
      .gildra-agent-menu-action,
      .gildra-agent-review-head button,
      .gildra-agent-menu-popover select,
      .gildra-review-model-control select {
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 7px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 500 11px/16px var(--dsw-font-family, system-ui);
      }
      .gildra-agent-menu-close,
      .gildra-agent-review-head button {
        min-height: 28px;
        padding: 5px 9px;
        cursor: pointer;
      }
      .gildra-agent-menu-close:hover,
      .gildra-agent-menu-close:focus-visible,
      .gildra-agent-menu-action:hover,
      .gildra-agent-menu-action:focus-visible,
      .gildra-agent-review-head button:hover,
      .gildra-agent-review-head button:focus-visible {
        border-color: var(--dsw-alias-state-business-primary);
        outline: none;
      }
      .gildra-agent-menu-action {
        width: 100%;
        padding: 10px 11px;
        text-align: left;
        cursor: pointer;
      }
      .gildra-agent-menu-action:hover,
      .gildra-agent-menu-action:focus-visible {
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 30%, var(--dsw-alias-bg-base));
      }
      .gildra-agent-review-block {
        display: grid;
        gap: 8px;
        margin-top: 8px;
        padding: 10px 11px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
      }
      .gildra-agent-review-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .gildra-agent-review-head button:disabled {
        cursor: default;
        opacity: .45;
      }
      .gildra-agent-review-label {
        display: grid;
        gap: 5px;
        min-width: 0;
      }
      .gildra-agent-review-label select {
        width: 100%;
        min-height: 32px;
        padding: 6px 8px;
      }
      .gildra-agent-menu-popover [data-kind="success"] {
        border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #43c778) 55%, var(--dsw-alias-border-l2));
      }
      .gildra-agent-menu-popover [data-kind="error"] {
        border-color: var(--dsw-alias-state-error-primary, #ff6b6b);
      }
      .gildra-agent-launcher-dialog {
        width: min(680px, 100%);
      }
      .gildra-agent-launcher-form textarea {
        min-height: 130px;
      }
      .gildra-review-model-control {
        display: grid;
        gap: 5px;
        margin: 8px 0;
        padding: 8px 0;
        border-top: 1px solid var(--ar-border, var(--dsw-alias-border-l2));
        border-bottom: 1px solid var(--ar-border, var(--dsw-alias-border-l2));
      }
      .gildra-review-model-control label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: var(--dsw-alias-label-primary);
        font-size: 11px;
        font-weight: 600;
      }
      .gildra-review-model-control select {
        width: min(230px, 65%);
        padding: 4px 7px;
      }
      @media (max-width: 520px) {
        .gildra-repository-backdrop {
          padding: 8px;
        }
        .gildra-repository-form,
        .gildra-repository-head {
          padding-right: 14px;
          padding-left: 14px;
        }
        .gildra-update-summary {
          grid-template-columns: 1fr;
        }
      }
    `

    const BRAND_HEADLINE = 'Gildra Coding'
    const LANGUAGE_CHOICE_KEY = 'gildra.language-choice.v1'
    const DEFAULT_HEADLINES = new Set(['Into the Unknown', 'Навстречу неизвестному'])
    const DEFAULT_BUILD_LABELS = new Set(['DSH Local Build'])

    const AUTOMATION_TEXT = new Map([
      ['Automations', 'Автоматизации'],
      ['Open Automations', 'Открыть автоматизации'],
      ['Start a conversation before opening Automations.', 'Сначала отправьте одно сообщение в новой сессии.'],
      ['Autonomous coding work', 'Автоматизация разработки'],
      ['New automation', 'Новая автоматизация'],
      ['Close form', 'Закрыть форму'],
      ['Workspace', 'Проект'],
      ['Working folder', 'Рабочая папка'],
      ['Total', 'Всего'],
      ['Active', 'Активные'],
      ['Next run', 'Следующий запуск'],
      ['Needs attention', 'Требуют внимания'],
      ['Not scheduled', 'Не запланировано'],
      ['All clear', 'Всё в порядке'],
      ['Workspace automations', 'Автоматизации проекта'],
      ['Recent runs', 'Последние запуски'],
      ['Refresh', 'Обновить'],
      ['Schedule fresh, auditable agent runs for this workspace.', 'Запускайте проверяемые задачи ИИ по расписанию для этого проекта.'],
      ['Each trigger opens a fresh DSH session with its own audit trail.', 'Каждый запуск получает отдельную сессию и журнал действий.'],
      ['Latest execution state across this workspace.', 'Последние результаты запусков в этом проекте.'],
      ['Put recurring coding work on autopilot', 'Передайте повторяющиеся задачи ИИ'],
      ['Create a focused task with an explicit schedule and permission boundary. Every run starts in a fresh session.', 'Выберите задачу, расписание и допустимый уровень доступа. Каждый запуск выполняется в отдельной сессии.'],
      ['Create your first automation', 'Создать первую автоматизацию'],
      ['Create an automation', 'Новая автоматизация'],
      ['Edit automation', 'Редактировать автоматизацию'],
      ['Write a self-contained prompt: scheduled runs do not inherit this conversation.', 'Опишите задачу полностью: запуски по расписанию не получают историю этого чата.'],
      ['Name', 'Название'],
      ['Task prompt', 'Задача для ИИ'],
      ['Model', 'Модель'],
      ['Follow global', 'Как в основном чате'],
      ['Resolve the live global selection when each run starts.', 'Использовать модель, выбранную в основном чате на момент запуска.'],
      ['Keep this automation on the selected provider and model.', 'Всегда использовать выбранную модель для этой автоматизации.'],
      ['Reasoning effort', 'Глубина рассуждения'],
      ['Model default', 'По умолчанию модели'],
      ['Reasoning follows the global selection.', 'Глубина следует настройке основного чата.'],
      ['Options are supplied by the selected model.', 'Доступные уровни зависят от выбранной модели.'],
      ['Schedule', 'Расписание'],
      ['Once', 'Один раз'],
      ['Interval', 'Интервал'],
      ['Daily', 'Каждый день'],
      ['Weekly', 'По неделям'],
      ['Run at', 'Запустить'],
      ['Every', 'Каждые'],
      ['minutes', 'минут'],
      ['Time', 'Время'],
      ['Days', 'Дни'],
      ['Time zone', 'Часовой пояс'],
      ['Permission boundary', 'Доступ к проекту'],
      ['Read only', 'Только чтение'],
      ['Inspect the workspace without changing files.', 'Проверять проект без изменения файлов.'],
      ['Workspace write', 'Можно исправлять файлы'],
      ['May edit files inside this workspace; approval is not inherited.', 'Разрешено изменять файлы только внутри проекта; подтверждения не наследуются.'],
      ['Cancel', 'Отмена'],
      ['Create automation', 'Создать автоматизацию'],
      ['Save changes', 'Сохранить'],
      ['No runs yet. Trigger an automation now or wait for its schedule.', 'Запусков пока нет. Запустите задачу вручную или дождитесь расписания.'],
      ['Mon', 'Пн'], ['Tue', 'Вт'], ['Wed', 'Ср'], ['Thu', 'Чт'], ['Fri', 'Пт'], ['Sat', 'Сб'], ['Sun', 'Вс'],
      ['Run now', 'Запустить сейчас'],
      ['Pause', 'Пауза'],
      ['Resume', 'Продолжить'],
      ['Edit', 'Изменить'],
      ['Delete', 'Удалить'],
      ['Scheduled agent jobs.', 'Задачи ИИ по расписанию.'],
      ['Configure what runs, when it runs, and which Harness agent executes it.', 'Настройте задачу, расписание и агента, который её выполнит.'],
      ['Paused', 'На паузе'],
      ['Task', 'Задача'],
      ['Describe the work and choose where the agent should run.', 'Опишите работу и выберите проект для запуска.'],
      ['Prompt', 'Промпт'],
      ['Instructions sent to a fresh agent. Prompts are not copied into run-history summaries.', 'Инструкция будет передана новому агенту. Промпт не дублируется в сводке истории запусков.'],
      ['Choose a Harness workspace or enter the absolute directory where the agent runs.', 'Выберите рабочую папку DSH или укажите абсолютный путь.'],
      ['Choose a common pattern, or switch to Custom for a five-field cron expression.', 'Выберите готовое расписание или задайте cron-выражение из пяти полей.'],
      ['Schedule frequency', 'Частота запуска'],
      ['Minutes', 'По минутам'],
      ['Hourly', 'Каждый час'],
      ['Weekdays', 'По будням'],
      ['Custom', 'Своё'],
      ['Minute past the hour', 'Минута внутри часа'],
      ['Day', 'День'],
      ['Current UTC offsets and daylight-saving changes are handled by the selected IANA time zone.', 'Смещение UTC и переход на летнее время учитываются по выбранному часовому поясу IANA.'],
      ['Agent & access', 'Агент и доступ'],
      ['Select the model, agent behavior, and filesystem permissions for each fresh run.', 'Выберите модель, пресет агента и доступ к файлам для каждого запуска.'],
      ['Harness default', 'По умолчанию DSH'],
      ['Models are listed together under provider titles. Blank uses the current Harness default.', 'Модели сгруппированы по провайдерам. Пустое значение использует текущую модель DSH.'],
      ['Default follows the selected model. Custom adapter-owned IDs remain supported.', 'По умолчанию используется уровень выбранной модели; пользовательские ID адаптера тоже поддерживаются.'],
      ['Agent preset', 'Пресет агента'],
      ['Uses the current Harness default when not explicitly selected.', 'Если ничего не выбрано, используется текущий пресет DSH.'],
      ['Permission preset', 'Режим доступа'],
      ['Workspace Write', 'Запись в рабочую папку'],
      ['Write inside the workspace; wider retries require approval.', 'Можно изменять файлы в рабочей папке; для более широких действий нужно подтверждение.'],
      ['Advanced', 'Дополнительно'],
      ['Job ID', 'ID задачи'],
      ['Auto-derived from the name. Use lowercase letters, digits, and hyphens.', 'Создаётся из названия. Используйте строчные латинские буквы, цифры и дефисы.'],
      ['Timeout (ms)', 'Таймаут (мс)'],
      ['Wall-clock limit for each run (1s to 24h).', 'Предельное время каждого запуска: от 1 секунды до 24 часов.'],
      ['Overlap policy', 'Параллельные запуски'],
      ['Skip the new run', 'Пропустить новый запуск'],
      ['Queue the next run', 'Поставить следующий в очередь'],
      ['Allow concurrent runs', 'Разрешить одновременные запуски'],
      ['Skip the run if a previous run is still active.', 'Пропустить запуск, если предыдущий ещё выполняется.'],
      ['Misfire policy', 'Пропущенные запуски'],
      ['Skip missed runs', 'Пропускать'],
      ['Run once after downtime', 'Один раз после простоя'],
      ['Run once after downtime for the latest missed occurrence.', 'После простоя выполнить только последний пропущенный запуск.'],
      ['No automations yet. Create your first scheduled agent job.', 'Автоматизаций пока нет. Создайте первую задачу по расписанию.'],
      ['No runs yet. Runs appear here once an automation is triggered manually or its schedule fires.', 'Запусков пока нет. Они появятся здесь после ручного запуска или срабатывания расписания.'],
    ])

    const AUTOMATION_PLACEHOLDERS = new Map([
      ['Daily regression triage', 'Ежедневная проверка проекта'],
      ['Review new test failures, identify the regression, and propose the smallest verified fix…', 'Опишите, что проверить, когда исправлять автоматически и какие действия запрещены…'],
      ['e.g. Morning standup notes', 'Например, ежедневная сводка'],
      ["Summarize yesterday's progress and list today's priorities…", 'Подведи итоги вчерашнего дня и перечисли приоритеты на сегодня…'],
    ])

    const AUTOMATION_PATTERNS = [
      [/^Scheduled agent jobs · revision (\d+) · refreshes every (\d+)s\.$/, 'Задачи ИИ по расписанию · ревизия $1 · обновление каждые $2 с.'],
      [/^Monday–Friday at (.+)$/, 'Пн–Пт в $1'],
      [/^Every (\d+) minutes · (.+)$/, 'Каждые $1 мин · $2'],
      [/^Every hour at :(\d+) · (.+)$/, 'Каждый час в $1 мин · $2'],
      [/^Every day at (.+)$/, 'Каждый день в $1'],
      [/^Automatic job ID · (.+) timeout · Skip overlaps · Run once after downtime$/, 'Автоматический ID · таймаут $1 · без параллельных запусков · один запуск после простоя'],
    ]

    const SETTINGS_FALLBACK_TEXT = new Map([
      ['Workspace Write', 'Запись в рабочую папку'],
      ['MCP/Skills', 'MCP/Навыки'],
      ['Proxy', 'Прокси'],
      ['Configure…', 'Настроить…'],
      ['Not configured — subscription requests go direct.', 'Не настроен — запросы подписок идут напрямую.'],
      ['Proxy settings', 'Настройки прокси'],
      ['Close', 'Закрыть'],
      ['Route subscription requests through a proxy', 'Направлять запросы подписок через прокси'],
      ['Proxy URL', 'Адрес прокси'],
      ['HTTP or HTTPS proxy only (Clash/mihomo, v2rayN…); socks is not supported.', 'Только HTTP- или HTTPS-прокси (Clash/mihomo, v2rayN…); SOCKS не поддерживается.'],
      ['Username (optional)', 'Имя пользователя (необязательно)'],
      ['Password', 'Пароль'],
      ['Leave blank to keep the saved password', 'Оставьте пустым, чтобы сохранить текущий пароль'],
      ['Clear the saved password', 'Удалить сохранённый пароль'],
      ['Bypass hosts', 'Исключения'],
      ['Comma-separated hostnames that keep going direct.', 'Имена хостов через запятую, для которых сохраняется прямое соединение.'],
      ['Applies to token exchange, model APIs, usage lookups, image/video generation and x_search. The OAuth authorization page opens in your browser and follows the browser/system proxy, not this setting.', 'Прокси используется для обмена токенов, API моделей, проверки лимитов, создания изображений/видео и x_search. Страница OAuth использует прокси браузера или системы, а не эту настройку.'],
      ['Test', 'Проверить'],
      ['Save', 'Сохранить'],
      ['Proxy username', 'Имя пользователя прокси'],
    ])

    const SETTINGS_FALLBACK_PATTERNS = [
      [/^(.+): (\d+) diagnostic; details are available in Host logs$/, '$1: диагностических сообщений — $2; подробности доступны в журнале хоста'],
    ]

    const CODE_MAP_TEXT = new Map([
      ['画布', 'Карта кода'],
      ['Canvas', 'Карта кода'],
      ['Canvas preview', 'Просмотр карты кода'],
      ['画布为空', 'Карта пока не создана'],
      ['会话智能体可通过 canvas_preview 工具渲染 HTML 设计稿到此处', 'Попросите ИИ построить карту проекта — результат появится здесь.'],
      ['隐私脱敏', 'Защита данных'],
      ['已渲染', 'Готово'],
      ['未渲染', 'Не создано'],
      ['刷新', 'Обновить'],
      ['清空', 'Очистить'],
      ['备注', 'Примечания'],
      ['仅当前会话 · 不落盘', 'Только эта сессия · без сохранения'],
      ['等待渲染', 'Ожидание карты'],
    ])

    const GITHUB_TEXT = new Map([
      ['GitHub pull requests, issues, and CI through the agent.', 'Pull request, задачи и CI GitHub через ИИ.'],
      ['GitHub token', 'Токен GitHub'],
      ['Stored in the credentials file, not here. Applied immediately; leave blank to keep the current token.', 'Хранится отдельно в защищённых учётных данных. Оставьте поле пустым, чтобы сохранить текущий токен.'],
      ['A token is configured.', 'Токен настроен.'],
      ['No token is configured; GitHub tools are unavailable until one is.', 'Токен не сохранён в DSH. При выполненном gh auth login инструменты подключатся автоматически.'],
      ['Unsaved', 'Не сохранено'],
      ['This deployment stores settings read-only.', 'В этой сборке настройки доступны только для чтения.'],
      ['Save', 'Сохранить'],
      ['Saving…', 'Сохранение…'],
      ['Discard', 'Отменить изменения'],
      ['The deployment did not accept this value; it was left for you to correct.', 'Не удалось сохранить значение. Исправьте его и повторите попытку.'],
      ['Expand: GitHub', 'Развернуть: GitHub'],
      ['Collapse: GitHub', 'Свернуть: GitHub'],
    ])

    const WORKSPACE_FILES_TEXT = new Map([
      ['工作区文件', 'Файлы проекта'],
      ['显示/隐藏工作区文件面板', 'Показать или скрыть файлы проекта'],
      ['刷新', 'Обновить'],
      ['关闭', 'Закрыть'],
      ['正在读取工作区…', 'Читаем рабочую папку…'],
      ['正在加载…', 'Загрузка…'],
      ['加载中…', 'Загрузка…'],
      ['读取失败', 'Не удалось прочитать файл'],
      ['读取目录失败', 'Не удалось прочитать папку'],
      ['无法确定工作区根目录', 'Не удалось определить рабочую папку'],
      ['（点击重试）', '(нажмите, чтобы повторить)'],
      ['（空文件）', '(пустой файл)'],
      ['（空目录）', '(пустая папка)'],
      ['图片', 'Изображение'],
      ['文本', 'Текст'],
      ['← 在左侧文件树中选择一个文件进行预览', '← Выберите файл в дереве слева для предпросмотра'],
      ['… 目录过大，仅显示前 500 项', '… Папка слишком большая: показаны первые 500 элементов'],
    ])

    const PLUGIN_RU_DICTIONARIES = {
      'settings.subscriptions': {
        nav: 'Подписки',
        intro: 'Вход и выход из провайдеров по подписке. Вход откроет страницу авторизации в новой вкладке; без браузера можно вставить адрес обратного вызова или код.',
        unavailable: 'Нет соединения: не удалось загрузить статус подписок.',
        checking: 'Проверка…',
        loginInProgress: 'Вход…',
        loggedIn: 'Вход выполнен',
        loggedInAccount: 'Вход выполнен: {account}',
        loggedInExpires: 'Вход выполнен · до {date}',
        loggedInAccountExpires: 'Вход выполнен: {account} · до {date}',
        notLoggedIn: 'Вход не выполнен',
        login: 'Войти',
        cancel: 'Отмена',
        logout: 'Выйти',
        logoutConfirm: 'Выйти из {provider}?',
        manualSummary: 'Вход через браузер не сработал? Вставьте адрес обратного вызова или код',
        manualPlaceholder: 'Адрес обратного вызова или код',
        submit: 'Отправить',
        loginMissingUrl: 'В ответе на вход нет authorizeUrl',
        deviceCodePrompt: 'Введите этот код на странице проверки GitHub:',
        deviceCodeCopy: 'Скопировать код',
        deviceCodeCopied: 'Скопировано',
        deviceCodeOpenPage: 'Открыть страницу проверки GitHub',
        usageTitle: 'Использование',
        usageRefresh: 'Обновить',
        usageLoading: 'Загрузка данных…',
        usageEmpty: 'Провайдер не вернул окон использования.',
        usageError: 'Не удалось получить данные: {message}',
        usageSession: '5-часовое окно',
        usageWeekly: 'Неделя',
        usageWindow: 'Окно',
        usageResets: 'сброс {date}',
        usagePlan: 'Тариф: {plan}',
        generating: 'Создание изображения…',
        image: 'изображение',
        viewImage: 'Открыть изображение',
        viewImageNamed: 'Открыть {name}',
        imageLoading: 'Загрузка…',
        imageLoadFailed: 'Повторить',
        imagePreview: 'Просмотр изображения',
        imageClose: 'Закрыть',
        generatingVideo: 'Создание видео…',
        videoLoading: 'Загрузка видео…',
        videoLoadFailed: 'Не удалось загрузить видео: {message}',
        speed: 'Скорость',
        speedStandard: 'Стандартная',
        speedStandardDescription: 'Обычная скорость',
        speedFast: 'Быстрая',
        speedFastDescription: 'В 1,5 раза быстрее, но с большим расходом',
        commandFast: 'Переключить скорость Codex (стандартная/быстрая)',
        commandFastUnavailable: 'Текущая модель не поддерживает быстрый режим; /fast работает только с моделями Codex, где он указан в каталоге.',
        proxyTitle: 'Прокси',
        proxyStatusNone: 'Не настроен — запросы подписок идут напрямую.',
        proxyStatusEnabled: 'Включён · {url}',
        proxyStatusError: 'Ошибка настройки: {message}',
        proxyConfigure: 'Настроить…',
        proxyDialogTitle: 'Настройки прокси',
        proxyDialogClose: 'Закрыть',
        proxyEnabled: 'Направлять запросы подписок через прокси',
        proxyUrl: 'Адрес прокси',
        proxyUrlPlaceholder: 'http://localhost:7890',
        proxyUrlHint: 'Только HTTP- или HTTPS-прокси (Clash/mihomo, v2rayN…); SOCKS не поддерживается.',
        proxyUsername: 'Имя пользователя (необязательно)',
        proxyUsernamePlaceholder: 'Имя пользователя прокси',
        proxyPassword: 'Пароль',
        proxyPasswordPlaceholder: 'Оставьте пустым, чтобы сохранить текущий пароль',
        proxyClearPassword: 'Удалить сохранённый пароль',
        proxyBypass: 'Исключения',
        proxyBypassPlaceholder: '127.0.0.1, localhost, *.example.com',
        proxyBypassHint: 'Имена хостов через запятую, для которых сохраняется прямое соединение.',
        proxyTest: 'Проверить',
        proxyTesting: 'Проверка…',
        proxyTestOk: 'Работает · HTTP {status} · {ms} мс',
        proxyTestOkDirect: 'Работает (напрямую, без прокси) · HTTP {status} · {ms} мс',
        proxyTestFail: 'Ошибка: {message}',
        proxySave: 'Сохранить',
        proxyCancel: 'Отмена',
        proxySaving: 'Сохранение…',
        proxyLoading: 'Загрузка настроек прокси…',
        proxyLoadFailed: 'Не удалось загрузить настройки прокси: {message}',
        proxySaved: 'Сохранено — новые запросы пойдут через прокси.',
        proxySaveFailed: 'Не удалось сохранить: {message}',
        proxyNote: 'Прокси используется для обмена токенов, API моделей, проверки лимитов, создания изображений/видео и x_search. Страница OAuth открывается в браузере и использует прокси браузера или системы, а не эту настройку.',
      },
      autoReviewPanel: {
        label: 'ИИ-ревью',
        title: 'Автоматическое ревью ИИ',
        state: 'Состояние',
        stateOn: 'Включено',
        stateOff: 'Выключено',
        enable: 'Включить',
        disable: 'Выключить',
        verdicts: 'Решения ИИ в этом ходе',
        failures: 'Ошибки в этом ходе',
        allTime: 'За всё время',
        allows: 'разрешено',
        denies: 'отклонено',
        fallbacks: 'передано дальше',
        neverRejects: 'жёстко запрещено',
        avg: 'среднее',
        circuit: 'Защита от повторных отказов сработала',
        circuitDetail: '{kind}: отказов {count}, действие {action}',
        empty: 'В этой сессии ещё не было решений ИИ-ревью.',
        recent: 'Последние решения',
        denyList: 'Повторные попытки для подтверждения',
        approve: 'Разрешить повтор',
        approveResult: 'Разрешено: {text}',
        approveFailed: 'Не удалось разрешить: {text}',
        switchedResult: 'Переключено: {text}',
        switchFailed: 'Не удалось переключить: {text}',
        unavailable: 'Панель ревью недоступна в этом режиме приложения.',
        decisionAllow: 'разрешить',
        decisionDeny: 'отклонить',
        fallbackLabel: 'передано дальше ({kind})',
        escalationLabel: 'передано на проверку из-за риска',
        riskLow: 'низкий риск',
        riskMedium: 'средний риск',
        riskHigh: 'высокий риск',
        ms: 'мс',
      },
      'settings.checkpointRewind': {
        tab: 'Контрольные точки',
        title: 'История контрольных точек',
        subtitle: 'Единые снимки файлов, сессии и настроек',
        refresh: 'Обновить',
        loading: 'Загружаем историю…',
        loadError: 'Не удалось загрузить историю',
        retry: 'Повторить',
        empty: 'Контрольных точек пока нет. Создайте её командой /checkpoint или инструментом checkpoint.',
        total: 'Показано {shown} из {total} · занято {bytes} (лимит: {count} на сессию, {quota} всего)',
        kindManual: 'вручную',
        kindAuto: 'автоматически',
        kindGuard: 'защитная',
        kindMutation: 'перед изменением',
        treeNone: 'копия файлов',
        replayReady: 'можно продолжить',
        replayFresh: 'новый контекст',
        selectA: 'Выбрать A (раньше)',
        selectB: 'Выбрать B (позже)',
        clearCompare: 'Сбросить сравнение',
        compareHint: 'Выберите две контрольные точки для сравнения.',
        comparing: 'Сравниваем…',
        compareError: 'Не удалось сравнить',
        filesTitle: 'Файлы проекта',
        filesChanged: 'Изменено: {changed} (добавлено {added}, удалено {removed})',
        filesTruncated: '… и другие файлы',
        configTitle: 'Снимок настроек',
        configChanged: 'Изменено строк: {lines}',
        configUnchanged: 'без изменений',
        sessionTitle: 'Позиция сессии',
        sessionDelta: 'позиция {fromSeq} (ход {fromTurn}, шаг {fromStep}) → {toSeq} (ход {toTurn}, шаг {toStep}); будет отброшено событий: {dropped}',
        fromNote: 'Заметка B',
        toNote: 'Заметка A',
        noNote: 'без заметки',
        rewindHint: 'Откат выполняется в сессии: /rewind <id> или /rewind workspace|session|config <id>. Перед действием приложение покажет изменения и запросит подтверждение.',
        copy: 'Копировать /rewind',
        copied: 'Скопировано',
        diffNote: 'Разница',
        guardBadge: 'защита',
      },
      'settings.pluginBridge': {
        tab: 'Плагины агентов',
        title: 'Мост плагинов агентов',
        bridgeTabs: 'Состояние по агентам',
        bridgeOverview: 'Обзор',
        codexBridge: 'Codex',
        claudeCodeBridge: 'Claude Code',
        piBridge: 'Pi',
        loading: 'Читаем плагины и каталоги…',
        loadError: 'Мост плагинов временно недоступен.',
        retry: 'Повторить',
        mutationError: 'Операция не выполнена. Существующие плагины не изменены.',
        installErrorTimeout: 'Источник плагина отвечал слишком долго. Повторите попытку или проверьте журнал Host.',
        installErrorInstalled: 'Этот плагин уже установлен. Обновите список.',
        installErrorUnsupported: 'Установка невозможна: мост не поддерживает возможности этого плагина.',
        installErrorInvalid: 'Некорректный манифест или структура плагина. Проверьте журнал Host.',
        installErrorActivation: 'Плагин загружен, но его возможности не подключились. Проверьте журнал Host.',
        installErrorSource: 'Не удалось загрузить источник. Проверьте адрес и соединение.',
        installErrorGeneric: 'Host не смог завершить установку.',
        rescan: 'Обновить список',
        piUpdates: 'Обновления пакетов Pi',
        piUpdateMode: 'Режим обновлений',
        piUpdateModeNotify: 'Только уведомлять',
        piUpdateModeAuto: 'Обновлять автоматически',
        piUpdateModeOff: 'Не проверять',
        checkUpdates: 'Проверить сейчас',
        updateAll: 'Обновить всё',
        update: 'Обновить',
        lastChecked: 'Последняя проверка',
        piUpdatesEmpty: 'Для импортированных пакетов Pi обновлений нет.',
        autoUpdatePackage: 'Разрешить автоматическое обновление этого пакета',
        piScope_user: 'Для пользователя',
        piScope_project: 'Для проекта',
        installed: 'Установлено',
        installedEmpty: 'В DSH пока не импортировано ни одного плагина.',
        configuredMarketplaces: 'Подключённые каталоги',
        marketplaceLocation: 'Локальный путь или GitHub-адрес каталога',
        add: 'Добавить',
        configuredEmpty: 'Подключённых каталогов нет.',
        plugins: 'плагинов',
        searchPlugins: 'Поиск плагинов',
        noPluginMatches: 'Подходящих плагинов нет.',
        discoveredMarketplaces: 'Найденные регистрации каталогов',
        discoveredMarketplacesEmpty: 'Каталоги Codex или Claude Code не найдены.',
        discoveredLocal: 'Найденные локальные плагины',
        discoveredLocalEmpty: 'Локальные плагины Codex, Claude Code или Pi не найдены.',
        rows: 'модулей возможностей',
        protected: 'защищено',
        unsupported: 'не поддерживается',
        codexHostRequired: 'Плагин использует подключение App из Codex. Подключитесь и войдите в Codex, чтобы оно заработало.',
        enabled: 'Включён',
        disabled: 'Выключен',
        foreignEnabled: 'Включён в источнике',
        foreignDisabled: 'Выключен в источнике',
        enable: 'Включить',
        disable: 'Выключить',
        install: 'Установить',
        installing: 'Установка…',
        working: 'Выполняется…',
        downloading: 'Загрузка…',
        remoteMarketplaceRegistration: 'Регистрация Git · полный каталог загрузится при добавлении',
        import: 'Импортировать',
        imported: 'Импортирован',
      },
      'skills-manager': {
        title: 'Навыки',
        desc: 'Локальные навыки DSH можно загружать, включать, выключать и удалять; общие навыки агентов доступны только для просмотра.',
        'btn.refresh': 'Обновить',
        'btn.upload': 'Загрузить',
        'btn.disable': 'Выключить',
        'btn.enable': 'Включить',
        'btn.repair.enable': 'Исправить и включить',
        'btn.delete': 'Удалить',
        'btn.cancel': 'Отмена',
        'btn.overwrite.upload': 'Заменить и загрузить',
        'btn.delete.confirm': 'Удалить',
        'btn.file.pick': 'Выбрать локальный файл',
        'btn.dir.pick': 'Выбрать папку навыка',
        'btn.uploading': 'Загрузка…',
        'btn.upload.dsh': 'Загрузить в DSH',
        'status.enabled': 'Включён',
        'status.disabled': 'Выключен',
        'status.invalid': 'Ошибка конфигурации',
        'status.bundle': 'Папка',
        'status.single': 'Один файл',
        'status.selected': 'Выбран',
        'summary.total.one': 'навык',
        'summary.total.other': 'навыков',
        'summary.enabled.one': 'включён',
        'summary.enabled.other': 'включено',
        'summary.group': '{count} элементов',
        'filter.category': 'Категория',
        'filter.all': 'Все',
        'filter.option': '{name} ({count})',
        'filter.showing.one': 'Показан {count} навык',
        'filter.showing.other': 'Показано навыков: {count}',
        search: 'Поиск',
        'search.placeholder': 'Название, тип или описание',
        'search.clear': 'Очистить поиск',
        'empty.search': 'Подходящих навыков нет. Измените запрос или выберите «{all}».',
        'empty.search.reset': 'Сбросить фильтры',
        'note.missing': 'Описание не указано',
        'empty.dir.uncreated': 'Папка ещё не создана; она появится после загрузки первого навыка.',
        'empty.dir.missing': 'Общая папка не существует.',
        'empty.skills.none': 'Навыки пока не установлены.',
        loading: 'Загрузка…',
        'error.action': 'Операция не выполнена: {error}',
        'sep.names': ', ',
        'sep.errors': '; ',
        'result.failed': 'Не удалось загрузить: {error}',
        'result.partial': 'Часть навыков загружена: {names}; ошибки: {errors}',
        'result.failed.only': 'Не удалось загрузить: {errors}',
        'result.done': 'Загрузка завершена: {names}',
        'result.skipped': 'Не импортировано: навыки с такими именами пропущены: {names}',
        'result.none': 'Ничего не импортировано.',
        'result.warnings': 'Предупреждение: {warnings}',
        'warning.backupUncleaned': 'Не удалось удалить резервную копию старой версии: {path} ({error})',
        'upload.title': 'Загрузить навык',
        'upload.close': 'Закрыть окно загрузки',
        'upload.drop.title': 'Перетащите сюда SKILL.md',
        'upload.drop.copy': 'или нажмите, чтобы открыть системный выбор файлов',
        'upload.hint': 'Выберите SKILL.md внутри папки навыка; остальные файлы этой папки тоже будут скопированы.',
        'upload.picking.dir': 'Открываем системный выбор папки…',
        'select.file.invalid': 'Выберите SKILL.md внутри папки навыка.',
        'select.path.missing': 'Файл SKILL.md выбран, но приложение не может прочитать его путь. Нажмите «Выбрать папку навыка».',
        'select.failed': 'Не удалось выбрать файл: {error}',
        'dir.selected': 'Папка навыка выбрана',
        'dir.service.missing': 'Приложение не может прочитать локальный путь и не предоставляет системный выбор папки.',
        'dir.pick.failed': 'Не удалось выбрать папку навыка: {error}',
        'confirm.overwrite.title': 'Найден навык с таким именем',
        'confirm.overwrite.desc': 'Будут заменены существующие навыки: {names}',
        'confirm.delete.title': 'Удалить навык?',
        'confirm.delete.desc': '«{name}» будет безвозвратно удалён из папки навыков DSH.',
        'error.root.readonly': 'В общей папке навыков агентов запрещено действие: {action}',
        'error.skill.notFound': 'Навык не найден: {name}',
        'error.skill.noFrontmatter': 'У навыка нет полного frontmatter; действие невозможно ({action}): {name}',
        'error.source.notFound': 'Путь не существует: {path}',
        'error.source.symlink': 'Источник навыка с символическими ссылками не поддерживается: {path}',
        'error.source.unrecognized': 'Не удалось распознать источник навыка: {path}',
        'error.source.tooDeep': 'Источник навыка глубже допустимого предела ({depth}): {path}',
        'error.import.overlap': 'Источник импорта не может совпадать с папкой навыков DSH, содержать её или находиться внутри неё.',
        'error.import.emptySource': 'В папке нет навыков: требуется подпапка с SKILL.md или отдельный .md-файл: {path}',
        'error.import.invalidName': 'Не удалось создать корректное имя kebab-case из «{name}».',
        'error.import.duplicateName': 'В источнике несколько навыков с одинаковым именем: {name}',
        'error.import.failed': 'Импорт не выполнен',
        'error.import.rollbackFailed': 'Не удалось откатить замену; резервная копия сохранена: {path} ({error})',
        'error.proto.forbidden': 'Изменение запрещено: отсутствует маркер приложения.',
        'error.proto.forbiddenHost': 'Недопустимый источник запроса.',
        'error.proto.contentType': 'Тело запроса должно иметь тип application/json.',
        'error.proto.method': 'Метод запроса не поддерживается.',
        'error.proto.unknownAction': 'Неизвестная операция.',
        'error.proto.bodyTooLarge': 'Тело запроса слишком большое.',
        'error.proto.invalidJson': 'Некорректный JSON в запросе.',
        'error.proto.nonJson': 'Сервер вернул ответ не в JSON (HTTP {status}).',
        'action.enable': 'включение',
        'action.disable': 'выключение',
        'action.delete': 'удаление',
        'action.toggle': 'включение или выключение',
        'root.dsh': 'Навыки DSH',
        'root.agents': 'Общие навыки агентов',
      },
      'at-file': {
        'dock.aria': 'Упомянутые пути проекта',
        'dock.remove': 'Убрать {name}',
        nav: 'Упоминания файлов',
        'settings.title': 'Упоминания файлов проекта',
        'settings.subtitle': 'Введите @, чтобы найти путь в проекте. Плагин передаёт путь, не читая содержимое файла.',
        'settings.enabled': 'Включить упоминания файлов через @',
        'settings.enabledDesc': 'При выключении скрываются поиск путей и выбранные ссылки, а пути не передаются модели.',
        'settings.ignorePastedMentions': 'Игнорировать @ в вставленном тексте',
        'settings.ignorePastedMentionsDesc': 'Вставленные через буфер @-ссылки останутся обычным текстом.',
        'settings.ignoreFiles': 'Фильтры файлов',
        'settings.ignoreFilesDesc': 'Правила применяются только к имени файла. Можно использовать точное имя или регулярное выражение.',
        'settings.scope': 'Область фильтра',
        'settings.global': 'Глобально',
        'settings.workspace': 'Проект',
        'settings.globalTitle': 'Глобальные правила',
        'settings.globalDesc': 'Применяются ко всем проектам.',
        'settings.workspaceTitle': 'Правила проекта',
        'settings.workspaceDesc': 'Применяются только к выбранному проекту вместе с глобальными правилами.',
        'settings.workspaceSelect': 'Проект',
        'settings.noWorkspace': 'Нет доступного проекта',
        'settings.restoreDefaults': 'Восстановить стандартные',
        'settings.clearWorkspace': 'Очистить правила проекта',
        'settings.emptyGlobal': 'Глобальных фильтров нет.',
        'settings.emptyWorkspace': 'У проекта нет дополнительных фильтров.',
        'settings.namePlaceholder': 'Например, desktop.ini',
        'settings.regexPlaceholder': 'Например, \\.map$ или ^test-',
        'settings.nameHint': 'Введите полное имя файла без пути.',
        'settings.regexHint': 'Регулярное выражение проверяется по полному имени файла без пути.',
        'settings.invalidName': 'Имя файла не может содержать разделители пути.',
        'settings.invalidRegex': 'Некорректное регулярное выражение.',
        'settings.duplicateName': 'Такое имя уже есть в текущем списке.',
        'settings.inheritedName': 'Это имя уже отфильтровано глобально.',
        'settings.add': 'Добавить',
        'settings.saving': 'Сохранение',
        'settings.remove': 'Удалить {name}',
        'settings.inherited': 'Также применяются глобальные правила',
        'settings.ruleType': 'Тип правила',
        'settings.kind.exact': 'Точное имя',
        'settings.kind.regex': 'Регулярное выражение',
        'settings.caseSensitive': 'Учитывать регистр',
        'settings.caseInsensitive': 'Не учитывать регистр',
        'settings.caseSensitiveOption': 'Учитывать регистр',
      },
      'dsh-context': {
        tab: 'Контекст',
        'cat.system': 'Системный промпт',
        'cat.tools': 'Схемы инструментов',
        'cat.user': 'Сообщения пользователя',
        'cat.inject': 'Добавленный контекст',
        'cat.assistant': 'Ответы ассистента',
        'cat.tool': 'Результаты инструментов',
        'overview.title': 'Текущий контекст',
        'overview.estimate': 'токенов (оценка)',
        'overview.free': 'Свободное окно',
        'overview.used': 'контекста использовано',
        'overview.ofUsed': 'использованного контекста',
        'overview.compactReserve': 'Резерв автосжатия: оно запускается на {pct}% окна, поэтому эта область обычно остаётся свободной.',
        'stats.title': 'Статистика контекста',
        'stats.hint': 'Содержится в текущем контексте',
        'stats.turns': 'Ходы',
        'stats.steps': 'Шаги',
        'stats.injects': 'Добавления',
        'stats.compactions': 'Сжатия',
        'stats.prunes': 'Очистки',
        'stats.toolCalls': 'Вызовы инструментов',
        'stats.images': 'Изображения',
        'stats.cacheHit': 'Попадание в кэш',
        'stats.cost': 'Стоимость',
        'stats.costTip': 'Приблизительная стоимость всей сессии по тарифам DeepSeek. Значение справочное.',
        'stats.costPriceHead': 'Цена за 1 млн токенов (пик | половина цены вне пика):',
        'stats.costHit': 'кэш',
        'stats.costMiss': 'без кэша',
        'stats.costOut': 'вывод',
        'plugin.title': 'О плагине',
        'plugin.hint': 'Расширенная панель контекста DSH',
        'plugin.name': 'Плагин',
        'plugin.github': 'GitHub',
        'tools.top': 'Самые объёмные схемы:',
        'tools.more': 'из {n}',
        'trend.title': 'История контекста',
        'gran.step': 'Шаг',
        'gran.turn': 'Ход',
        'settings.title': 'Контекст',
        'settings.desc': 'Настройки отображения панели Context',
        'settings.gran': 'Детализация графика',
        'settings.mode': 'Режим графика',
        'settings.expand': 'Развернуть',
        'settings.collapse': 'Свернуть',
        'settings.readOnly': 'В этом окружении настройки доступны только для чтения',
        'gran.total': 'Всего',
        'gran.delta': 'Изменение',
        'gran.modeHint': 'Всего: накопленный состав; изменение: разница с предыдущим запросом.',
        'trend.hint': '✂ означает сжатие или очистку; Шаг/Ход меняет детализацию.',
        'trend.empty': 'После отправки сообщения здесь появится состав контекста каждого запроса.',
        'detail.step': 'Ход {t} · шаг {s}',
        'detail.turn': 'Ход {t} · шагов: {n}',
        'detail.lastStep': 'Последний шаг',
        'detail.estTotal': 'Оценка ≈ {n}',
        'detail.actual': 'Фактически во входе {n}',
        'detail.output': 'Вывод {n}',
        'detail.cache': 'Кэш {n}%',
        'events.title': 'События контекста',
        'events.empty': 'Событий пока нет: здесь появятся сжатия, добавления и смена модели.',
        'events.at': 'Ход {t} · шаг {s}',
        'events.range': 'Ход {t} · шаги {a}→{b}',
        'events.rangeTo': 'Ход {a} · шаг {as} → ход {b} · шаг {bs}',
        'kind.inject': 'Добавление',
        'kind.compaction': 'Сжатие',
        'kind.prune': 'Очистка',
        'kind.model': 'Смена модели',
        'kind.mode': 'Режим',
        'nodes.title': 'Сообщения',
        'nodes.hint': 'видимые модели сейчас, новые сверху',
        'nodes.more': '… пропущено предыдущих сообщений: {n}',
        'nodes.empty': 'Сейчас модель не видит сообщений',
        loading: 'Читаем журнал сессии…',
        error: 'Не удалось прочитать контекст: ',
        'error.retry': 'Повторить',
        footer: 'Оценка использует приближение около 4 символов на токен; фактическое значение сообщает провайдер.',
        'tip.step': 'Ход {t} · шаг {s}',
        'tip.turn': 'Ход {t} · шагов: {n}',
        'tip.total': 'Всего ≈ {n}',
        'tip.actual': ' (фактически {n})',
        'tip.delta': 'Δ {n}',
        'ev.compaction': 'Контекст сжат: сводка заменила сообщений — {n}',
        'ev.prune': 'Результат инструмента очищен',
        'ev.skill': 'Добавлен навык {name}',
        'ev.model': 'Модель изменена: {a} → {b}',
        'ev.mode.plan.on': 'Режим планирования включён',
        'ev.mode.plan.off': 'Режим планирования выключен',
        'form.instructions': 'Инструкции',
        'form.catalog': 'Обновление каталога',
        'form.snapshot': 'Снимок состояния',
        'form.notice': 'Уведомление',
        'form.relay': 'Передача агенту',
        'form.recall': 'Воспоминание',
        'form.context': 'Добавление контекста',
        'node.toolResult': 'Результат инструмента',
        'node.calls': 'Вызовы ',
        'node.empty': '(пустой ответ)',
        'node.nonText': '(нетекстовое сообщение)',
        'node.snapshot': 'Снимок: ',
        'node.skillTag': 'Навык · {name}',
        'cmd.desc': 'Показать текущий состав контекста по шагам',
        'cmd.close': 'Закрыть',
        'browser.title': 'Просмотр контекста',
        'browser.live': 'Сейчас (следующий запрос)',
        'browser.liveNow': 'Сейчас · следующий запрос',
        'browser.items': 'Элементов: {n}',
        'browser.missingLive': '… ещё {n} предыдущих сообщений входят в контекст за пределами загруженного окна.',
        'browser.approx': 'Некоторые удалённые сообщения уже не хранятся, поэтому состав приблизительный.',
        'browser.deltaHint': 'относительно предыдущего хода',
        'browser.noHeader': 'Старая версия плагина: доступны только оценки токенов.',
        'browser.noEpoch': 'Заголовок этого шага уже не хранится.',
        'browser.noContent': 'Полное содержимое вне загруженного окна. Загрузите старую историю в чате.',
        'browser.loading': 'Загружаем полное содержимое из истории…',
        'browser.preview': 'Предпросмотр',
        'tool.desc': 'Описание',
        'tool.params': 'Параметры',
        'tool.paramsEmpty': '(параметров нет)',
        'tool.jsonToggle': 'Показать исходный JSON',
        'tool.jsonHide': 'Свернуть',
        'rich.raw': 'Исходный текст',
        'rich.md': 'Markdown',
        'rich.toMd': 'Показать как Markdown',
        'rich.toRaw': 'Показать исходный текст',
        'block.thinking': 'Рассуждение',
        'block.answer': 'Ответ',
        'block.content': 'Содержимое',
        'block.result': 'Результат',
        'block.summary': 'Сводка',
        'block.line': '1 строка',
        'block.lines': 'Строк: {n}',
        'call.ok': 'Готово',
        'call.fail': 'Ошибка',
        'call.exit': 'код выхода {n}',
        'node.failed': 'Инструмент завершился с ошибкой',
        'attach.images': 'Изображения',
        'attach.other': 'Другое содержимое',
        'attach.image': 'Изображение',
        'attach.open': 'Открыть изображение',
        'attach.preview': 'Предпросмотр изображения',
        'attach.close': 'Закрыть',
        'attach.loading': '…',
        'attach.loadFailed': 'Не удалось загрузить · нажмите для повтора',
        'attach.raw': 'Оригинал',
        'attach.sent': 'Отправлено',
        'attach.token': 'Токены',
        'attach.tokensTip': 'Приблизительный расход токенов изображения.',
      },
    }

    const AGENT_SYNC_TEXT = new Map([
      ['MCP/Skills 管理', 'Управление MCP и навыками'],
      ['MCP/Skills', 'MCP/Навыки'],
      ['MCP/Skills同步', 'Синхронизация MCP и навыков'],
      ['MCP/Skills同步 →', 'Синхронизировать MCP и навыки →'],
      ['🔄 刷新', '🔄 Обновить'],
      ['加载中…', 'Загрузка…'],
      ['启停 / 移除已同步到 DSH 的 MCP 与 skill', 'Включение, отключение и удаление MCP и навыков в DSH'],
      ['（当前会话未挂载 skill 提供方，模型暂不可用，文件已就位）', 'Провайдер навыков не подключён к этой сессии; файлы уже установлены.'],
      ['⇄ 迁移技能', '⇄ Перенести навыки'],
      ['＋ 添加 MCP', '＋ Добавить MCP'],
      ['＋ 添加 Skill', '＋ Добавить навык'],
      ['暂无 profile 数据', 'Данные профиля пока недоступны'],
      ['暂无已同步的 MCP', 'Синхронизированных MCP пока нет'],
      ['暂无已同步的 skill', 'Синхронизированных навыков пока нет'],
      ['该工作区暂无 skill', 'В этом проекте навыков пока нет'],
      ['← 返回', '← Назад'],
      ['从其他 agent 一键同步 MCP 与 skill 进 DSH', 'Импорт MCP и навыков из других агентов в DSH'],
      ['更多 ▾', 'Ещё ▾'],
      ['无自定义源', 'Пользовательских источников нет'],
      ['名称', 'Название'],
      ['类型', 'Тип'],
      ['目录 (skills)', 'Папка с навыками'],
      ['路径', 'Путь'],
      ['绝对路径', 'Абсолютный путь'],
      ['添加', 'Добавить'],
      ['插件设置', 'Настройки плагина'],
      ['⚙️ 设置', '⚙️ Настройки'],
      ['✕ 关闭', '✕ Закрыть'],
      ['Skill 同步方式', 'Способ синхронизации навыков'],
      ['文件复制（默认）', 'Копирование файлов (по умолчанию)'],
      ['软连接（链接源目录，实时同步）', 'Ссылка на исходную папку (обновляется автоматически)'],
      ['MCP 同步目标', 'Профили для MCP'],
      ['全部 profile（desktop + web）', 'Все профили (desktop + web)'],
      ['仅 desktop', 'Только desktop'],
      ['仅 web', 'Только web'],
      ['保存', 'Сохранить'],
      ['全选本页', 'Выбрать всё на странице'],
      ['同步选中 MCP', 'Синхронизировать выбранные MCP'],
      ['同步到', 'Синхронизировать в'],
      ['全局 (~/.dsh/skills)', 'Глобально (~/.dsh/skills)'],
      ['同步选中 Skill', 'Синхронизировать выбранные навыки'],
      ['覆盖同步', 'Перезаписать'],
      ['添加技能', 'Добавить навык'],
      ['添加到', 'Добавить в'],
      ['全局', 'Глобально'],
      ['选择来源', 'Выберите источник'],
      ['📁 选择文件夹', '📁 Выбрать папку'],
      ['📄 选择单个 .md', '📄 Выбрать файл .md'],
      ['📦 选择 .zip', '📦 Выбрать .zip'],
      ['拖放', 'Перетащить'],
      ['将 .md / .zip / 技能文件夹拖到这里', 'Перетащите сюда .md, .zip или папку навыка'],
      ['文件夹需包含 SKILL.md（目录束）；单文件需为带 frontmatter 的 .md', 'Папка должна содержать SKILL.md; одиночный .md — frontmatter.'],
      ['添加 MCP 服务器', 'Добавить MCP-сервер'],
      ['传输方式', 'Транспорт'],
      ['stdio（本地命令）', 'stdio (локальная команда)'],
      ['streamable-http（URL）', 'streamable-http (URL)'],
      ['命令', 'Команда'],
      ['参数', 'Аргументы'],
      ['环境变量', 'Переменные окружения'],
      ['KEY=VALUE，每行一个', 'KEY=VALUE, по одной на строку'],
      ['添加到 DSH 的 MCP 客户端（重启后生效）', 'MCP будет добавлен в DSH после перезапуска.'],
      ['迁移技能', 'Перенести навыки'],
      ['选择技能', 'Выберите навыки'],
      ['当前作用域没有技能', 'В этой области нет навыков'],
      ['迁移到', 'Перенести в'],
      ['方式', 'Способ'],
      ['移动（删除源）', 'Переместить (удалить источник)'],
      ['复制（保留源）', 'Копировать (сохранить источник)'],
      ['复制到目标作用域，源位置保留', 'Копия будет создана в целевой области, источник сохранится.'],
      ['迁移 = 移动到目标作用域（源位置删除）', 'Перемещение удалит навык из исходной области.'],
      ['复制', 'Копировать'],
      ['迁移', 'Перенести'],
      ['编辑分组', 'Изменить группу'],
      ['新建分组', 'Новая группа'],
      ['分组名称', 'Название группы'],
      ['输入分组名称（必填）', 'Введите название группы'],
      ['删除分组', 'Удалить группу'],
      ['保存分组', 'Сохранить группу'],
      ['＋ 分组', '＋ Группа'],
      ['全部', 'Все'],
      ['🔍 搜索技能…', '🔍 Поиск навыков…'],
      ['启用', 'Включён'],
      ['已停用', 'Выключен'],
      ['🔗 软连接', '🔗 Ссылка'],
      ['移除', 'Удалить'],
      ['确认删除?', 'Удалить?'],
      ['点击停用', 'Нажмите, чтобы выключить'],
      ['点击启用', 'Нажмите, чтобы включить'],
      ['MCP 详情', 'Сведения об MCP'],
      ['Skill 详情', 'Сведения о навыке'],
      ['Skills', 'Навыки'],
      ['来源', 'Источник'],
      ['描述', 'Описание'],
      ['仓库', 'Репозиторий'],
      ['内容', 'Содержимое'],
      ['错误', 'Ошибка'],
      ['环境变量(键)', 'Переменные окружения (имена)'],
      ['Headers(键)', 'Заголовки (имена)'],
      ['(空)', '(пусто)'],
      ['自定义', 'Пользовательский'],
    ])

    const TEAM_TEXT = new Map([
      ['Agent team', 'Команда агентов'],
      ['Team room', 'Командная комната'],
      ['Mailbox', 'Сообщения'],
      ['Task board', 'Доска задач'],
      ['Shared workspace', 'Общие заметки'],
      ['All idle', 'Все свободны'],
      ['This session has no team yet', 'В этой сессии пока нет команды'],
      ['Ask the main session to call team_spawn for the first teammate.', 'Попросите главного агента создать первого участника команды.'],
      ['No messages yet', 'Сообщений пока нет'],
      ['No tasks yet', 'Задач пока нет'],
      ['The shared workspace is empty', 'Общие заметки пока пусты'],
      ['Members write conclusions here with team_note instead of messaging them around.', 'Участники сохраняют выводы здесь, чтобы не пересылать их сообщениями.'],
      ['Panels', 'Панели'],
      ['Close the panel', 'Закрыть панель'],
      ['Who is doing what', 'Кто чем занят'],
      ['Traffic', 'Переписка'],
      ['Nothing said yet', 'Переписки пока нет'],
      ['working…', 'работает…'],
      ['Main session', 'Главный агент'],
      ['Back to the main session', 'Вернуться к главному агенту'],
      ['Managed', 'Управляемый'],
      ['Peer', 'Равноправный'],
      ['Working', 'Работает'],
      ['Idle', 'Свободен'],
      ['To do', 'К выполнению'],
      ['In progress', 'В работе'],
      ['Done', 'Готово'],
      ['Unassigned', 'Не назначено'],
      ['report', 'отчёт'],
      ['finished', 'завершено'],
    ])

    const TEAM_PATTERNS = [
      [/^(\d+) members$/, '$1 участников'],
      [/^(\d+) working$/, '$1 работают'],
      [/^(\d+)\/(\d+) tasks$/, '$1/$2 задач'],
      [/^(\d+) open$/, '$1 открыто'],
      [/^Open the session of (.+)$/, 'Открыть сессию: $1'],
      [/^hop (\d+)$/, 'переход $1'],
    ]

    const AUTOMATION_TEMPLATES = [
      {
        title: 'Проверка кода',
        name: 'Проверка качества кода',
        permission: 'read-only',
        prompt: 'Проверь состояние проекта без изменения файлов. Определи штатные команды тестов, линтера и проверки типов, запусти только безопасные проверки, сгруппируй ошибки по первопричине и приложи краткие доказательства. Не устанавливай зависимости, не делай commit, push или deploy.',
      },
      {
        title: 'Проверка новых данных',
        name: 'Проверка свежести данных',
        permission: 'read-only',
        prompt: 'Проверь, появились ли новые валидные данные. Проверь источник, обязательные срезы, объём, свежесть и целостность результата; HTTP 200 сам по себе не считается успехом. Ничего не меняй. Если данные отсутствуют или устарели, укажи точную причину и безопасный следующий шаг.',
      },
      {
        title: 'Исправление парсера',
        name: 'Контролируемое восстановление парсера',
        permission: 'workspace-write',
        prompt: 'Проверь, получил ли парсер новые валидные данные. Сохрани текущие данные и LKG. Если сбор сломан, воспроизведи сбой на минимальном примере, сделай только минимальное локальное исправление, запусти профильные тесты и проверку контракта источника. Не выполняй deploy, commit или push и остановись после одной проверенной попытки.',
      },
    ]

    function applyBrandHeadline(root = document.body) {
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const current = node.nodeValue?.trim()
        if (DEFAULT_HEADLINES.has(current)) {
          node.nodeValue = node.nodeValue.replace(current, BRAND_HEADLINE)
        } else if (DEFAULT_BUILD_LABELS.has(current)) {
          node.nodeValue = node.nodeValue.replace(current, 'Gildra DSH')
        }
      }
    }

    function hasLanguageChoice() {
      try {
        return window.localStorage.getItem(LANGUAGE_CHOICE_KEY) === 'done'
      } catch {
        return false
      }
    }

    function ensureLanguageChoice(ctx) {
      if (hasLanguageChoice() || document.querySelector('.gildra-language-backdrop')) return
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-language-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-language-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-language-title')
      dialog.setAttribute('aria-describedby', 'gildra-language-description')
      dialog.innerHTML = `
        <h1 id="gildra-language-title">Choose your language · Выберите язык</h1>
        <p id="gildra-language-description">You can change it later in Settings. Язык можно изменить позже в настройках.</p>
        <div class="gildra-language-options">
          <button type="button" data-language="en">
            <strong>English</strong>
            <small>Use the application in English</small>
          </button>
          <button type="button" data-language="ru">
            <strong>Русский</strong>
            <small>Использовать приложение на русском языке</small>
          </button>
        </div>
        <p class="gildra-language-status" role="status" aria-live="polite"></p>
      `
      backdrop.appendChild(dialog)
      const siblings = [...document.body.children]
      const inertState = siblings.map(element => ({ element, inert: element.inert }))
      for (const { element } of inertState) element.inert = true
      document.body.appendChild(backdrop)

      const buttons = [...dialog.querySelectorAll('button[data-language]')]
      const status = dialog.querySelector('[role="status"]')
      const close = () => {
        for (const item of inertState) item.element.inert = item.inert
        backdrop.remove()
      }
      const choose = (event) => {
        const button = event.currentTarget
        const language = button.dataset.language
        for (const candidate of buttons) candidate.disabled = true
        try {
          ctx.locale.setLocale(language)
          try { window.localStorage.setItem(LANGUAGE_CHOICE_KEY, 'done') } catch {}
          close()
        } catch (error) {
          for (const candidate of buttons) candidate.disabled = false
          status.textContent = error instanceof Error ? error.message : String(error)
          button.focus()
        }
      }
      for (const button of buttons) button.addEventListener('click', choose)
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return
        const enabled = buttons.filter(button => !button.disabled)
        if (enabled.length === 0) return
        const first = enabled[0]
        const last = enabled.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      })
      const active = ctx.locale.getLocale().active
      const preferred = buttons.find(button => button.dataset.language === active) ?? buttons[0]
      preferred.focus()
    }

    function setControlledValue(element, value) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    function fillAutomationTemplate(template) {
      const form = document.querySelector('.dsh-automation-create')
      if (!form) return false
      const name = form.querySelector('.dsh-automation-form-grid > label:first-child input')
      const prompt = form.querySelector('textarea')
      if (name instanceof HTMLInputElement) setControlledValue(name, template.name)
      if (prompt instanceof HTMLTextAreaElement) setControlledValue(prompt, template.prompt)
      const permission = form.querySelector(`input[type="radio"][value="${template.permission}"]`)
      if (permission instanceof HTMLInputElement && !permission.checked) permission.click()
      name?.focus()
      return true
    }

    function openAutomationTemplate(template) {
      if (fillAutomationTemplate(template)) return
      const open = document.querySelector('.dsh-automation-header > .dsh-automation-button--primary')
      if (open instanceof HTMLButtonElement) {
        open.click()
        window.setTimeout(() => { fillAutomationTemplate(template) }, 0)
      }
    }

    function ensureAutomationQuickstart() {
      const shell = document.querySelector('.dsh-automation-shell')
      const scope = shell?.querySelector('.dsh-automation-scope')
      if (!shell || !scope || shell.querySelector('.gildra-automation-quickstart')) return

      const quickstart = document.createElement('section')
      quickstart.className = 'gildra-automation-quickstart'
      quickstart.setAttribute('aria-label', 'Быстрый запуск автоматизации')
      const heading = document.createElement('strong')
      heading.textContent = 'Быстрый запуск'
      const hint = document.createElement('p')
      hint.textContent = 'Выберите готовый сценарий, затем задайте модель и расписание.'
      const list = document.createElement('div')
      list.className = 'gildra-automation-template-list'
      for (const template of AUTOMATION_TEMPLATES) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = template.title
        button.addEventListener('click', () => { openAutomationTemplate(template) })
        list.appendChild(button)
      }
      quickstart.append(heading, hint, list)
      scope.insertAdjacentElement('afterend', quickstart)
    }

    function translateWithPatterns(value, dictionary, patterns = []) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = dictionary.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function translateAutomationValue(value) {
      return translateWithPatterns(value, AUTOMATION_TEXT, AUTOMATION_PATTERNS)
    }

    function applyAutomationTranslations() {
      const roots = document.querySelectorAll('.dsh-automation-shell, .dsh-automation-sidebar-action, [data-dsh-automation-entry], [data-dsh-automations-trigger], [role="tab"], [role="dialog"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateAutomationValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
          const translated = AUTOMATION_PLACEHOLDERS.get(element.getAttribute('placeholder'))
          if (translated) element.setAttribute('placeholder', translated)
        }
        for (const element of root.querySelectorAll('input.dsh-auto-combobox-input')) {
          const translated = translateAutomationValue(element.value)
          if (translated && document.activeElement !== element) element.value = translated
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateAutomationValue(element.getAttribute(attribute))
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
      for (const entry of document.querySelectorAll('[data-dsh-automation-entry], [data-dsh-automations-trigger]')) {
        entry.setAttribute('aria-label', 'Открыть автоматизации')
        entry.setAttribute('title', 'Автоматизации')
      }
    }

    function applySettingsFallbackTranslations() {
      for (const root of document.querySelectorAll('[role="dialog"], [data-composer-seat]')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateWithPatterns(node.nodeValue, SETTINGS_FALLBACK_TEXT, SETTINGS_FALLBACK_PATTERNS)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateWithPatterns(current, SETTINGS_FALLBACK_TEXT, SETTINGS_FALLBACK_PATTERNS)
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    const AGENT_SYNC_PATTERNS = [
      [/^全部 \((\d+)\)$/, 'Все ($1)'],
      [/^自定义 \((\d+)\)$/, 'Пользовательский ($1)'],
      [/^全局 \((\d+)\)$/, 'Глобально ($1)'],
      [/^工作区: (.+)$/, 'Проект: $1'],
      [/^可同步的 MCP \((\d+)\)$/, 'Доступные MCP ($1)'],
      [/^可同步的 Skills \((\d+)\)$/, 'Доступные навыки ($1)'],
      [/^自定义源 \((\d+)\)$/, 'Пользовательские источники ($1)'],
      [/^已启用 (.+)$/, 'Включено: $1'],
      [/^已停用 (.+)$/, 'Выключено: $1'],
      [/^已移除 (.+)$/, 'Удалено: $1'],
      [/^已删除 (.+)$/, 'Удалено: $1'],
      [/^加载失败: (.+)$/, 'Ошибка загрузки: $1'],
      [/^同步失败: (.+)$/, 'Ошибка синхронизации: $1'],
      [/^移除失败: (.+)$/, 'Ошибка удаления: $1'],
      [/^操作失败: (.+)$/, 'Ошибка операции: $1'],
      [/^保存失败: (.+)$/, 'Ошибка сохранения: $1'],
      [/^删除失败: (.+)$/, 'Ошибка удаления: $1'],
      [/^添加失败: (.+)$/, 'Ошибка добавления: $1'],
      [/^迁移失败: (.+)$/, 'Ошибка переноса: $1'],
      [/^工作区暂无 (.+)$/, 'В проекте пока нет: $1'],
    ]

    function translateAgentSyncValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = AGENT_SYNC_TEXT.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of AGENT_SYNC_PATTERNS) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function applyAgentSyncTranslations() {
      for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
        if (button.textContent?.trim() !== 'MCP/Skills') continue
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
        let text
        while ((text = walker.nextNode())) {
          if (text.nodeValue?.trim() === 'MCP/Skills') {
            text.nodeValue = text.nodeValue.replace('MCP/Skills', 'MCP/Навыки')
            break
          }
        }
      }
      for (const root of document.querySelectorAll('.ags-panel')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateAgentSyncValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateAgentSyncValue(current)
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    function translateTeamValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = TEAM_TEXT.get(trimmed)
      if (exact) return exact
      for (const [pattern, replacement] of TEAM_PATTERNS) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
      }
      return null
    }

    function applyTeamTranslations() {
      const roots = document.querySelectorAll('[class$="_stage"], [class*="_stage "], [role="tab"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateTeamValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateTeamValue(element.getAttribute(attribute))
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    function translateCodeMapValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = CODE_MAP_TEXT.get(trimmed)
      if (exact) return exact
      if (trimmed.startsWith('来源 ')) return `Источник: ${trimmed.slice(3)}`
      if (trimmed.startsWith('更新于 ')) return `Обновлено: ${trimmed.slice(4)}`
      return null
    }

    function applyCodeMapTranslations() {
      const roots = document.querySelectorAll('.cv-panel, [role="tab"]')
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateCodeMapValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[aria-label], [title]')) {
          for (const attribute of ['aria-label', 'title']) {
            const translated = translateCodeMapValue(element.getAttribute(attribute))
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    function translateWorkspaceFilesValue(value) {
      const trimmed = value?.trim()
      if (!trimmed) return null
      const exact = WORKSPACE_FILES_TEXT.get(trimmed)
      if (exact) return exact
      const codeLimit = trimmed.match(/^⚠ 文件过长，仅预览前 (\d+) 行$/)
      if (codeLimit) return `⚠ Файл слишком большой: показаны первые ${codeLimit[1]} строк`
      return null
    }

    function applyMappedTranslations(selector, dictionary, translateValue = (value) => dictionary.get(value?.trim())) {
      for (const root of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const translated = translateValue(node.nodeValue)
          if (translated) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated)
        }
        for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const current = element.getAttribute(attribute)
            const translated = translateValue(current)
            if (translated) element.setAttribute(attribute, translated)
          }
        }
      }
    }

    function applyGitHubTranslations() {
      applyMappedTranslations('.ghc-card', GITHUB_TEXT)
    }

    function applyWorkspaceFilesTranslations() {
      applyMappedTranslations('.wsf-root, .wsf-hbtn', WORKSPACE_FILES_TEXT, translateWorkspaceFilesValue)
    }

    const PRESET_STUDIO_ENDPOINT = '/gildra/agent-presets'
    const REPOSITORY_ENDPOINT = '/gildra/workspaces/clone'
    const UPDATE_ENDPOINT = '/gildra/update'
    const AGENT_CONTROL_ENDPOINT = '/gildra/agent-control'
    const presetModelsApplied = new Map()
    let presetMappingsPromise
    let agentControlPromise
    const agentModelCatalogPromises = new Map()

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

    function suggestedRepositoryFolder(value) {
      try {
        return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).at(-1) ?? '')
          .replace(/\.git$/i, '')
      } catch {
        return ''
      }
    }

    function openRepositoryImport(ctx) {
      document.querySelector('.gildra-repository-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-repository-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-repository-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-repository-title')
      dialog.innerHTML = `
        <header class="gildra-repository-head">
          <div>
            <h2 id="gildra-repository-title">Добавить репозиторий</h2>
            <p>Вставьте ссылку — Gildra клонирует проект и сразу откроет его как рабочую папку.</p>
          </div>
          <button class="gildra-repository-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <form class="gildra-repository-form">
          <label class="gildra-repository-field">
            HTTPS-ссылка на репозиторий
            <input name="url" type="url" maxlength="2048" required autofocus
              placeholder="https://github.com/organization/project.git" autocomplete="off" spellcheck="false">
            <small>Поддерживаются GitHub, GitLab и Bitbucket. Для приватного репозитория Git должен иметь доступ заранее.</small>
          </label>
          <label class="gildra-repository-field">
            Имя папки <small>(необязательно)</small>
            <input name="folderName" maxlength="80" placeholder="Автоматически из ссылки" autocomplete="off" spellcheck="false">
            <small>Проект будет сохранён в папке «Gildra Projects» в вашем профиле.</small>
          </label>
          <p class="gildra-repository-status" role="status">Готово к импорту.</p>
          <div class="gildra-repository-actions">
            <button type="button" data-cancel>Отмена</button>
            <button type="submit">Клонировать и открыть</button>
          </div>
        </form>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)

      const form = dialog.querySelector('form')
      const url = form.elements.namedItem('url')
      const folderName = form.elements.namedItem('folderName')
      const submit = form.querySelector('button[type="submit"]')
      const cancel = form.querySelector('[data-cancel]')
      const closeButton = dialog.querySelector('.gildra-repository-close')
      const status = form.querySelector('[role="status"]')
      let folderEdited = false
      let busy = false

      folderName.addEventListener('input', () => { folderEdited = true })
      url.addEventListener('input', () => {
        if (!folderEdited) folderName.value = suggestedRepositoryFolder(url.value)
      })
      const close = () => {
        if (busy) return
        document.removeEventListener('keydown', onKey)
        backdrop.remove()
      }
      const onKey = (event) => {
        if (event.key === 'Escape') close()
      }
      closeButton.addEventListener('click', close)
      cancel.addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      document.addEventListener('keydown', onKey)
      url.focus()

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (!form.reportValidity()) return
        busy = true
        submit.disabled = true
        cancel.disabled = true
        closeButton.disabled = true
        status.dataset.kind = ''
        status.textContent = 'Клонирую репозиторий. Большой проект может занять несколько минут…'
        let clonedPath
        try {
          const response = await fetch(REPOSITORY_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ url: url.value, folderName: folderName.value || undefined }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true || typeof body.workspace?.path !== 'string') {
            throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          }
          clonedPath = body.workspace.path
          status.textContent = 'Репозиторий готов. Добавляю рабочую папку…'
          const workspace = await ctx.workspaces.create({ path: clonedPath })
          ctx.workspaces.startSession(workspace.workspaceId)
          status.dataset.kind = 'success'
          status.textContent = `Проект «${body.workspace.name}» добавлен и открыт.`
          busy = false
          window.setTimeout(close, 500)
        } catch (error) {
          busy = false
          submit.disabled = false
          cancel.disabled = false
          closeButton.disabled = false
          status.dataset.kind = 'error'
          const message = error instanceof Error ? error.message : String(error)
          status.textContent = clonedPath
            ? `Репозиторий сохранён в ${clonedPath}, но не добавлен в список: ${message}`
            : message
        }
      })
    }

    function ensureRepositoryEntry(ctx) {
      const buttons = [...document.querySelectorAll('button[aria-label]')]
      const addWorkspace = buttons.find(button => [
        'Add workspace',
        'Добавить рабочую папку',
      ].includes(button.getAttribute('aria-label')))
      const parent = addWorkspace?.parentElement
      if (!addWorkspace || !parent || parent.querySelector('.gildra-repository-add')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `${addWorkspace.className} gildra-repository-add`
      button.setAttribute('aria-label', 'Добавить репозиторий по ссылке')
      button.setAttribute('title', 'Добавить репозиторий по ссылке')
      button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="3" r="1.75"/><circle cx="4" cy="13" r="1.75"/><circle cx="12" cy="8" r="1.75"/><path d="M4 4.75v6.5M5.75 4.5c3.2 0 2.9 3.5 4.5 3.5"/></svg>'
      button.addEventListener('click', () => openRepositoryImport(ctx))
      addWorkspace.insertAdjacentElement('afterend', button)
    }

    function ensureNativeWorkspacePicker(ctx) {
      if (!window.gildraHost || typeof window.gildraHost.call !== 'function') return
      const button = [...document.querySelectorAll('button[aria-label]')].find(candidate => [
        'Add workspace',
        'Добавить рабочую папку',
      ].includes(candidate.getAttribute('aria-label')))
      if (!button || button.dataset.gildraHostPicker === 'true') return
      button.dataset.gildraHostPicker = 'true'
      button.addEventListener('click', async (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
        try {
          const result = await window.gildraHost.call('files.chooseDirectory')
          if (result?.cancelled || typeof result?.path !== 'string') return
          const workspace = await ctx.workspaces.create({ path: result.path })
          ctx.workspaces.startSession(workspace.workspaceId)
        } catch (error) {
          window.alert(`Не удалось добавить рабочую папку: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, true)
    }

    let updateStatusPromise

    async function fetchUpdateStatus(force = false) {
      if (force) updateStatusPromise = undefined
      updateStatusPromise ??= fetch(UPDATE_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.ok !== true || typeof body.status !== 'object') {
          throw new Error(body.error ?? `HTTP ${String(response.status)}`)
        }
        return body.status
      }).catch((error) => {
        updateStatusPromise = undefined
        throw error
      })
      return updateStatusPromise
    }

    function openUpdateDialog() {
      document.querySelector('.gildra-update-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-repository-backdrop gildra-update-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-repository-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-update-title')
      dialog.innerHTML = `
        <header class="gildra-repository-head">
          <div>
            <h2 id="gildra-update-title">Обновление Gildra DSH</h2>
            <p>Обновляет Harness, плагины и приложение. Ваши проекты, сессии, авторизации и настройки сохраняются.</p>
          </div>
          <button class="gildra-repository-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="gildra-repository-form">
          <div class="gildra-update-summary">
            <div class="gildra-update-version"><small>Установлено</small><strong data-current>—</strong></div>
            <div class="gildra-update-version"><small>Последний выпуск</small><strong data-latest>—</strong></div>
          </div>
          <p class="gildra-update-notice">Проверяю официальный канал выпусков Gildra…</p>
          <p class="gildra-repository-status" role="status">Подключение к GitHub…</p>
          <div class="gildra-repository-actions">
            <button type="button" data-close>Закрыть</button>
            <button type="button" data-install disabled>Установить обновление</button>
          </div>
        </div>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)
      const current = dialog.querySelector('[data-current]')
      const latest = dialog.querySelector('[data-latest]')
      const notice = dialog.querySelector('.gildra-update-notice')
      const status = dialog.querySelector('[role="status"]')
      const install = dialog.querySelector('[data-install]')
      let busy = false

      const close = () => {
        if (busy) return
        document.removeEventListener('keydown', onKey)
        backdrop.remove()
      }
      const onKey = event => { if (event.key === 'Escape') close() }
      dialog.querySelector('.gildra-repository-close').addEventListener('click', close)
      dialog.querySelector('[data-close]').addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      document.addEventListener('keydown', onKey)

      void fetchUpdateStatus(true).then((value) => {
        current.textContent = value.currentVersion || 'неизвестно'
        latest.textContent = value.latestVersion || 'неизвестно'
        if (value.updateAvailable && value.assetAvailable) {
          notice.textContent = `Доступна версия ${value.latestVersion}. Архив проверяется по SHA-256, затем приложение перезапустится автоматически.`
          status.dataset.kind = 'success'
          status.textContent = 'Обновление готово к установке.'
          install.disabled = false
          install.textContent = `Установить ${value.latestVersion}`
          document.querySelector('.gildra-update-sidebar-entry')?.setAttribute('data-update-available', 'true')
        } else if (value.updateAvailable) {
          notice.textContent = 'В выпуске пока нет готового архива для этой операционной системы.'
          status.dataset.kind = 'error'
          status.textContent = 'Автоматическая установка этого выпуска недоступна.'
        } else {
          notice.textContent = value.currentVersion === value.latestVersion
            ? 'У вас установлена последняя стабильная версия.'
            : 'Установленная сборка новее последнего опубликованного стабильного выпуска.'
          status.dataset.kind = 'success'
          status.textContent = 'Обновление не требуется.'
        }
        if (value.lastUpdate?.status === 'error') {
          status.dataset.kind = 'error'
          status.textContent = `Предыдущее обновление не завершилось: ${value.lastUpdate.error ?? 'неизвестная ошибка'}`
        }
      }).catch((error) => {
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
        notice.textContent = 'Проверьте подключение к интернету и повторите попытку позже.'
      })

      install.addEventListener('click', async () => {
        busy = true
        install.disabled = true
        dialog.querySelector('[data-close]').disabled = true
        dialog.querySelector('.gildra-repository-close').disabled = true
        status.dataset.kind = ''
        status.textContent = 'Запускаю безопасное обновление…'
        try {
          const response = await fetch(UPDATE_ENDPOINT, {
            method: 'POST',
            headers: { 'x-gildra-action': 'install-update', accept: 'application/json' },
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          status.dataset.kind = 'success'
          status.textContent = 'Обновление скачивается. После проверки приложение закроется и откроется снова.'
          notice.textContent = 'Не выключайте компьютер до повторного запуска Gildra DSH.'
        } catch (error) {
          busy = false
          install.disabled = false
          dialog.querySelector('[data-close]').disabled = false
          dialog.querySelector('.gildra-repository-close').disabled = false
          status.dataset.kind = 'error'
          status.textContent = error instanceof Error ? error.message : String(error)
        }
      })
    }

    function ensureUpdateEntry() {
      if (document.querySelector('.gildra-update-sidebar-entry')) return
      const settings = [...document.querySelectorAll('button')].find(button => [
        'Settings', 'Настройки',
      ].includes(button.getAttribute('aria-label') ?? button.textContent?.trim()))
      const wrapper = settings?.parentElement
      const area = wrapper?.parentElement
      if (!settings || !wrapper || !area) return
      const entry = wrapper.cloneNode(false)
      entry.removeAttribute('id')
      entry.classList.add('gildra-update-sidebar-entry')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = settings.className
      button.setAttribute('aria-label', 'Обновления')
      button.setAttribute('title', 'Проверить обновления')
      button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15.7 7.2A6.2 6.2 0 1 0 16 12"/><path d="M12.8 7.2h2.9V4.3"/></svg><span>Обновления</span>'
      button.addEventListener('click', openUpdateDialog)
      entry.appendChild(button)
      area.insertBefore(entry, wrapper)
      void fetchUpdateStatus().then(value => {
        if (value.updateAvailable && value.assetAvailable) entry.dataset.updateAvailable = 'true'
      }).catch(() => {})
    }

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

    function teamTab() {
      return [...document.querySelectorAll('[role="tab"]')].find(tab =>
        tab instanceof HTMLElement
        && tab.offsetParent !== null
        && [
          'Agent team',
          'Команда агентов',
          'Комната команды',
        ].includes(tab.textContent?.trim()))
    }

    function cloneAgentMenuSvg(source, suffix) {
      if (!(source instanceof SVGElement)) return undefined
      const clone = source.cloneNode(true)
      const ids = new Map()
      for (const element of clone.querySelectorAll('[id]')) {
        const previous = element.id
        const next = `${previous}-gildra-${suffix}`
        ids.set(previous, next)
        element.id = next
      }
      for (const element of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          let value = attribute.value
          for (const [previous, next] of ids) value = value.replaceAll(`#${previous}`, `#${next}`)
          if (value !== attribute.value) element.setAttribute(attribute.name, value)
        }
      }
      clone.setAttribute('aria-hidden', 'true')
      return clone
    }

    function positionAgentMenu(popover, trigger) {
      const rect = trigger.getBoundingClientRect()
      const width = popover.offsetWidth || 340
      const height = popover.offsetHeight || 260
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))
      const preferredTop = rect.bottom + 8
      const top = preferredTop + height <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, rect.top - height - 8)
      popover.style.left = `${String(Math.round(left))}px`
      popover.style.top = `${String(Math.round(top))}px`
    }

    function openAgentMenu(ctx, trigger) {
      const previous = document.querySelector('.gildra-agent-menu-popover')
      if (previous) {
        previous.dispatchEvent(new CustomEvent('gildra:close'))
        return
      }
      const currentTeamTab = teamTab()
      const popover = document.createElement('section')
      popover.id = 'gildra-agent-menu'
      popover.className = 'gildra-agent-menu-popover'
      popover.setAttribute('role', 'dialog')
      popover.setAttribute('aria-label', 'Агенты и авто-ревью')
      popover.innerHTML = `
        <header class="gildra-agent-menu-head">
          <div>
            <strong>Агенты</strong>
            <span>Команда и независимая проверка кода</span>
          </div>
          <button class="gildra-agent-menu-close" type="button">Закрыть</button>
        </header>
        <button class="gildra-agent-menu-action" type="button" data-open-agents>
          <strong>${currentTeamTab ? 'Открыть комнату команды' : 'Создать сабагента'}</strong>
          <span>${currentTeamTab ? 'Посмотреть задачи и результаты участников' : 'Настроить роль, задачу и модель участника'}</span>
        </button>
        <section class="gildra-agent-review-block" aria-label="Авто-ревью">
          <div class="gildra-agent-review-head">
            <strong>Авто-ревью</strong>
            <button type="button" data-open-review>Открыть</button>
          </div>
          <label class="gildra-agent-review-label">
            <small>Модель проверки</small>
            <select class="gildra-review-model-select" aria-label="Модель авто-ревью" disabled>
              <option>Загрузка…</option>
            </select>
          </label>
          <span class="gildra-review-model-status">Загружаю настройку…</span>
        </section>
      `
      document.body.appendChild(popover)
      trigger.setAttribute('aria-expanded', 'true')

      let returnFocus = false
      const close = () => {
        document.removeEventListener('mousedown', onOutside)
        document.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', onMove)
        window.removeEventListener('scroll', onMove, true)
        popover.remove()
        trigger.setAttribute('aria-expanded', 'false')
        if (returnFocus && trigger.isConnected) trigger.focus()
      }
      const onOutside = event => {
        if (!popover.contains(event.target) && event.target !== trigger) close()
      }
      const onKey = event => {
        if (event.key === 'Escape') {
          returnFocus = true
          close()
          return
        }
        if (event.key === 'Tab') {
          const focusable = [...popover.querySelectorAll('button:not(:disabled), select:not(:disabled)')]
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }
      const onMove = () => positionAgentMenu(popover, trigger)
      popover.addEventListener('gildra:close', close, { once: true })
      popover.querySelector('.gildra-agent-menu-close').addEventListener('click', () => {
        returnFocus = true
        close()
      })
      document.addEventListener('mousedown', onOutside)
      document.addEventListener('keydown', onKey)
      window.addEventListener('resize', onMove)
      window.addEventListener('scroll', onMove, true)

      const status = popover.querySelector('.gildra-review-model-status')
      const select = popover.querySelector('.gildra-review-model-select')
      const openReview = popover.querySelector('[data-open-review]')
      const reviewButton = document.querySelector('[data-dsh-auto-review-button]')
      openReview.disabled = !(reviewButton instanceof HTMLButtonElement)
      openReview.title = openReview.disabled
        ? 'Панель появится после первого сообщения в сессии.'
        : 'Открыть состояние авто-ревью'
      popover.querySelector('[data-open-agents]').addEventListener('click', () => {
        const tab = teamTab()
        close()
        if (tab instanceof HTMLButtonElement) tab.click()
        else window.setTimeout(() => openAgentLauncher(ctx), 0)
      })
      openReview.addEventListener('click', () => {
        const button = document.querySelector('[data-dsh-auto-review-button]')
        close()
        if (button instanceof HTMLButtonElement) button.click()
      })
      wireReviewModelSelect(ctx, select, status)
      positionAgentMenu(popover, trigger)
      popover.querySelector('[data-open-agents]').focus()
    }

    function ensureAgentCenter(ctx) {
      const seat = document.querySelector('[data-composer-seat]')
      if (!seat) return
      seat.querySelector('.gildra-agent-center')?.remove()
      const presetSlot = seat.querySelector('[data-slot="conversation.hero.agentPreset"]')
      const row = presetSlot?.parentElement
      if (!(row instanceof HTMLElement) || row.querySelector('.gildra-agent-menu-anchor')) return
      const template = presetSlot.querySelector('button')
      if (!(template instanceof HTMLButtonElement)) return
      const trigger = template.cloneNode(false)
      trigger.type = 'button'
      trigger.classList.add('gildra-agent-menu-trigger')
      trigger.removeAttribute('title')
      trigger.setAttribute('aria-label', 'Открыть меню агентов')
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-controls', 'gildra-agent-menu')
      trigger.setAttribute('aria-expanded', 'false')
      const icons = template.querySelectorAll('svg')
      const agentIcon = cloneAgentMenuSvg(icons[0], 'agent')
      const chevron = cloneAgentMenuSvg(icons[icons.length - 1], 'chevron')
      if (agentIcon) trigger.appendChild(agentIcon)
      trigger.appendChild(document.createTextNode('Агенты'))
      if (chevron && chevron !== agentIcon) trigger.appendChild(chevron)
      trigger.addEventListener('click', () => openAgentMenu(ctx, trigger))
      const anchor = document.createElement('span')
      anchor.className = 'gildra-agent-menu-anchor'
      anchor.appendChild(trigger)
      row.appendChild(anchor)
    }

    function ensureReviewPanelModelControl(ctx) {
      for (const panel of document.querySelectorAll('[data-dsh-auto-review-panel]')) {
        if (panel.querySelector('.gildra-review-model-control')) continue
        const control = document.createElement('section')
        control.className = 'gildra-review-model-control'
        control.innerHTML = `
          <label>
            Модель проверки
            <select class="gildra-review-model-select" aria-label="Модель проверки" disabled>
              <option>Загрузка…</option>
            </select>
          </label>
          <span class="gildra-review-model-status">Загружаю настройку…</span>
        `
        const title = panel.querySelector('[data-dsh-auto-review-title]')
        title?.insertAdjacentElement('afterend', control)
        wireReviewModelSelect(
          ctx,
          control.querySelector('.gildra-review-model-select'),
          control.querySelector('.gildra-review-model-status'),
        )
      }
    }

    function closePresetStudio(backdrop) {
      backdrop.remove()
    }

    function openPresetStudio(ctx) {
      document.querySelector('.gildra-preset-studio-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'gildra-preset-studio-backdrop'
      const dialog = document.createElement('section')
      dialog.className = 'gildra-preset-studio-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-labelledby', 'gildra-preset-studio-title')
      dialog.innerHTML = `
        <header class="gildra-preset-studio-head">
          <div>
            <h2 id="gildra-preset-studio-title">Новый пресет агента</h2>
            <p>Задайте роль, системный промпт и модель. Инженерные инструменты и работа с командой подключаются автоматически.</p>
          </div>
          <button class="gildra-preset-studio-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <form class="gildra-preset-studio-form">
          <label class="gildra-preset-field">
            Название
            <input name="name" maxlength="80" required placeholder="Например, Архитектор" autocomplete="off">
          </label>
          <label class="gildra-preset-field">
            Идентификатор
            <input name="id" maxlength="64" required pattern="[a-z0-9][a-z0-9-]*" placeholder="architect" autocomplete="off" spellcheck="false">
            <small>Латинские буквы, цифры и дефисы.</small>
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Описание
            <input name="description" maxlength="240" placeholder="Когда использовать этого агента">
          </label>
          <label class="gildra-preset-field gildra-preset-field--wide">
            Системный промпт
            <textarea name="systemPrompt" maxlength="32000" required placeholder="Ты — ведущий архитектор. Сначала изучай кодовую базу, затем предлагай минимальные проверяемые изменения…"></textarea>
          </label>
          <label class="gildra-preset-field">
            Модель
            <select name="model" disabled><option>Загрузка моделей…</option></select>
          </label>
          <label class="gildra-preset-field">
            Глубина рассуждения
            <select name="effort" disabled><option>По умолчанию модели</option></select>
          </label>
          <p class="gildra-preset-studio-status" role="status">Загружаю доступные модели…</p>
          <div class="gildra-preset-studio-actions">
            <button type="button" data-cancel>Отмена</button>
            <button type="submit" disabled>Создать пресет</button>
          </div>
        </form>
      `
      backdrop.appendChild(dialog)
      document.body.appendChild(backdrop)

      const form = dialog.querySelector('form')
      const name = form.elements.namedItem('name')
      const id = form.elements.namedItem('id')
      const model = form.elements.namedItem('model')
      const effort = form.elements.namedItem('effort')
      const submit = form.querySelector('button[type="submit"]')
      const status = form.querySelector('[role="status"]')
      let idEdited = false

      id.addEventListener('input', () => { idEdited = true })
      name.addEventListener('input', () => {
        if (!idEdited) id.value = slugifyPresetId(name.value)
      })
      const close = () => {
        document.removeEventListener('keydown', onKey)
        closePresetStudio(backdrop)
      }
      dialog.querySelector('.gildra-preset-studio-close').addEventListener('click', close)
      form.querySelector('[data-cancel]').addEventListener('click', close)
      backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
      const onKey = (event) => {
        if (event.key !== 'Escape') return
        close()
      }
      document.addEventListener('keydown', onKey)

      void loadModelCatalog(ctx, model, effort, status).then(() => {
        model.disabled = false
        submit.disabled = false
        name.focus()
      }).catch((error) => {
        status.dataset.kind = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      })

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (!form.reportValidity()) return
        const { provider, model: modelId } = selectedModel(model, { groups: [] })
        submit.disabled = true
        status.dataset.kind = ''
        status.textContent = 'Создаю и проверяю пресет…'
        try {
          const response = await fetch(PRESET_STUDIO_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              id: id.value,
              name: name.value,
              description: form.elements.namedItem('description').value,
              systemPrompt: form.elements.namedItem('systemPrompt').value,
              provider,
              model: modelId,
              reasoningEffort: effort.value || undefined,
              source: 'engineering',
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
          await presetMappings(true)
          status.dataset.kind = 'success'
          status.textContent = 'Пресет создан и проверен. Обновляю список…'
          window.setTimeout(() => window.location.reload(), 650)
        } catch (error) {
          submit.disabled = false
          status.dataset.kind = 'error'
          status.textContent = error instanceof Error ? error.message : String(error)
        }
      })
    }

    function ensurePresetStudioEntry(ctx) {
      if (document.querySelector('.gildra-preset-studio-entry')) return
      const headings = [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')]
      const heading = headings.find(node => /agent\s*presets?|пресет/i.test(node.textContent ?? ''))
      if (!heading || heading.closest('.gildra-preset-studio-dialog')) return
      const section = heading.parentElement
      if (!section) return
      const entry = document.createElement('div')
      entry.className = 'gildra-preset-studio-entry'
      const copy = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = 'Конструктор агентов'
      const hint = document.createElement('span')
      hint.textContent = 'Создайте пресет с собственным системным промптом и закреплённой моделью.'
      copy.append(title, hint)
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Создать пресет'
      button.addEventListener('click', () => openPresetStudio(ctx))
      entry.append(copy, button)
      heading.insertAdjacentElement('afterend', entry)
    }

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
        // Context Doctor uses the overlay stylesheet and its native plugin
        // lifecycle; no DOM ownership is duplicated here.
        enhance() {},
      },
      {
        id: 'developer-tools',
        enhance(ctx) {
          applyBrandHeadline()
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
        },
      },
      {
        id: 'automations',
        enhance() {
          applyAutomationTranslations()
          ensureAutomationQuickstart()
        },
      },
    ])

    function applyUiEnhancements(ctx) {
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
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => ['Automations', 'Автоматизации'].includes(candidate.textContent?.trim()))
      if (!(tab instanceof HTMLElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      tab.click()
      document.querySelector('.dsh-automation-sidebar-feedback')?.remove()
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
        const timer = window.setInterval(() => {
          applyAutomationTranslations()
          applyAgentSyncTranslations()
          applyTeamTranslations()
          applyCodeMapTranslations()
          applyGitHubTranslations()
          applyWorkspaceFilesTranslations()
          applySettingsFallbackTranslations()
        }, 500)
        return () => window.clearInterval(timer)
      }, 'gildra-ui-compact: plugin interface translation')

      ctx.effect(() => {
        document.addEventListener('click', handleAutomationEntry, true)
        return () => document.removeEventListener('click', handleAutomationEntry, true)
      }, 'gildra-ui-compact: automation navigation')
    }

    exports.apply = apply
    exports.inject = ['locale', 'connection', 'sessions', 'remote', 'modelDirectories', 'workspaces']
    return module.exports
  },
})
