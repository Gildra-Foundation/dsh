    const CSS = `
      body:has(.dsh-auto-workspace) .sysmon,
      body:has([data-context-doctor] [role="dialog"]) .sysmon {
        display: none !important;
      }
      .sysmon[data-gildra-collapsed="true"] {
        top: 12px !important;
        right: 12px !important;
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        min-height: 30px !important;
        overflow: hidden !important;
        border-radius: 8px !important;
      }
      .sysmon[data-gildra-collapsed="true"] > :not(.sysmon__head),
      .sysmon[data-gildra-collapsed="true"] .sysmon__head > :not(.sysmon__toggle) {
        display: none !important;
      }
      .sysmon[data-gildra-collapsed="true"] .sysmon__head {
        position: absolute !important;
        inset: 0 !important;
        display: block !important;
        min-height: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }
      .sysmon[data-gildra-collapsed="true"] .sysmon__toggle {
        position: absolute !important;
        inset: 0 !important;
        display: grid !important;
        width: 30px !important;
        height: 30px !important;
        padding: 0 !important;
        place-items: center !important;
        color: var(--dsw-alias-state-success-primary, #43c778) !important;
        font-size: 17px !important;
        font-weight: 560 !important;
      }
      .gildra-suppressed {
        display: none !important;
      }
      .gildra-workspace-identity {
        margin: 2px 0 6px;
        font-size: 11px;
        line-height: 1.35;
        color: var(--dsw-alias-content-secondary, #8b93a7);
        word-break: break-all;
      }
      .gildra-workspace-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 0;
        font-size: 11px;
      }
      .gildra-workspace-row[data-state="orphaned"] .gildra-workspace-detail {
        color: var(--dsw-alias-state-warning-primary, #e0a13c);
      }
      .gildra-workspace-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gildra-workspace-detail {
        flex: 0 0 auto;
        color: var(--dsw-alias-content-secondary, #8b93a7);
      }
      .gildra-workspace-actions {
        display: inline-flex;
        gap: 4px;
      }
      .gildra-workspace-actions button,
      .gildra-workspace-create {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-primary, #2c3140);
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .gildra-workspace-actions button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .gildra-workspace-create {
        margin-top: 4px;
        width: 100%;
      }
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

      .gildra-environments {
        position: fixed;
        z-index: 90;
        box-sizing: border-box;
        margin: 0;
        padding: 0 12px 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
        font-family: var(--dsw-font-family, system-ui);
      }
      .gildra-workspaces-with-environments {
        box-sizing: border-box;
        padding-top: var(--gildra-environment-space, 0px) !important;
      }
      .gildra-brand-environment {
        display: inline-flex;
        align-items: center;
        min-height: 18px;
        box-sizing: border-box;
        gap: 5px;
        margin-left: 5px;
        padding: 2px 6px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent);
        color: var(--dsw-alias-label-secondary);
        font-size: 8px;
        font-weight: 720;
        line-height: 11px;
        letter-spacing: .05em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      [data-slot="sidebar.brand.name"] > span:nth-child(2):not(.gildra-brand-environment) {
        display: none;
      }
      .gildra-brand-environment::before {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--dsw-alias-state-success-primary, #43c778);
        content: '';
      }
      .gildra-brand-environment[data-kind="remote"] {
        border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2));
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 48%, transparent);
        color: var(--dsw-alias-state-business-primary);
      }
      .gildra-environment-group + .gildra-environment-group {
        margin-top: 10px;
      }
      .gildra-environment-heading {
        display: flex;
        align-items: center;
        min-height: 20px;
        padding: 0 8px 4px;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        font-size: 10px;
        font-weight: 650;
        line-height: 14px;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      .gildra-environment-list {
        display: grid;
        gap: 2px;
      }
      .gildra-environment-row {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr) auto;
        align-items: center;
        width: 100%;
        min-height: 36px;
        box-sizing: border-box;
        gap: 9px;
        padding: 6px 8px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .gildra-environment-row:hover,
      .gildra-environment-row:focus-visible {
        background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .12));
        outline: none;
      }
      .gildra-environment-row[aria-current="true"] {
        background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 46%, transparent);
      }
      .gildra-environment-row:disabled {
        cursor: wait;
        opacity: .7;
      }
      .gildra-environment-dot {
        width: 7px;
        height: 7px;
        box-sizing: border-box;
        border-radius: 50%;
        background: var(--dsw-alias-label-tertiary, #7b8493);
      }
      .gildra-environment-row[data-state="connected"] .gildra-environment-dot,
      .gildra-environment-row[aria-current="true"] .gildra-environment-dot {
        background: var(--dsw-alias-state-success-primary, #43c778);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary, #43c778) 16%, transparent);
      }
      .gildra-environment-row[data-state="connecting"] .gildra-environment-dot {
        background: var(--dsw-alias-state-warning-primary, #e8ab3b);
      }
      .gildra-environment-copy {
        min-width: 0;
      }
      .gildra-environment-name,
      .gildra-environment-detail {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gildra-environment-name {
        font-size: 12px;
        font-weight: 560;
        line-height: 16px;
      }
      .gildra-environment-detail {
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        line-height: 14px;
      }
      .gildra-environment-state {
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        line-height: 14px;
        white-space: nowrap;
      }
      .gildra-environment-row[data-state="error"] .gildra-environment-state {
        color: var(--dsw-alias-state-error-primary, #ff6b6b);
      }
      .gildra-environment-empty {
        margin: 0;
        padding: 4px 8px 2px 26px;
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        line-height: 15px;
      }
      .gildra-environment-refresh {
        margin-left: auto;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .gildra-environment-refresh:hover,
      .gildra-environment-refresh:focus-visible {
        color: var(--dsw-alias-label-primary);
        outline: none;
      }
      .gildra-legacy-ssh-trigger {
        display: none !important;
      }
      .gildra-collapsed-environment {
        position: fixed;
        z-index: 91;
        top: 14px;
        left: 54px;
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        box-sizing: border-box;
        gap: 6px;
        padding: 4px 9px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2));
        border-radius: 7px;
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
        color: var(--dsw-alias-state-business-primary);
        font-family: var(--dsw-font-family, system-ui);
        font-size: 10px;
        font-weight: 680;
        line-height: 14px;
        letter-spacing: .015em;
        box-shadow: 0 3px 12px rgba(0, 0, 0, .12);
        cursor: pointer;
      }
      .gildra-collapsed-environment::before {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--dsw-alias-state-success-primary, #43c778);
        content: '';
      }
      .gildra-collapsed-environment[hidden] {
        display: none !important;
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

