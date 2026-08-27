# Modularity & Team Collaboration Contracts

Контракт второй итерации слоя AI-качества: как Gildra заставляет агента писать
модульный код (а не God-файлы и spaghetti) и как несколько сотрудников с
разными Runtime безопасно работают над одним проектом. Дополняет
[`docs/ai-quality.md`](ai-quality.md); граница безопасности неизменна —
[`docs/runtime-reliability.md`](runtime-reliability.md).

## Конвейер

```text
Task → Repository Understanding → Module Change Plan → Team Overlap Check
     → Isolated Worktree → Implementation → Modularity Analyzer
     → Verification (immutable snapshot, sanitized env)
     → Independent Review (capability, не строка) → Fix → Re-Verification
     → PR / trusted CI evidence → Human Review (CODEOWNERS)
```

## Architecture Policy

Проектная политика архитектуры — часть Quality Policy (`architecture`-секция):

```json
{
  "architecture": {
    "layers": [
      { "id": "domain", "patterns": ["src/domain/**"], "mayDependOn": [] },
      { "id": "application", "patterns": ["src/application/**"], "mayDependOn": ["domain"] },
      {
        "id": "infrastructure",
        "patterns": ["src/infrastructure/**"],
        "mayDependOn": ["application", "domain"]
      },
      { "id": "ui", "patterns": ["src/ui/**"], "mayDependOn": ["application", "domain"] }
    ],
    "modules": [
      {
        "id": "auth.service",
        "patterns": ["src/domain/auth/**"],
        "publicEntrypoints": ["src/domain/auth/index.js"]
      }
    ],
    "limits": { "fileLinesWarning": 400, "functionLinesWarning": 80, "moduleGrowthWarning": 200 },
    "gates": {
      "NEW_DEPENDENCY_CYCLE": "BLOCK",
      "CROSS_LAYER_IMPORT": "BLOCK",
      "OVERSIZED_MODULE_GROWTH": "REVIEW"
    }
  }
}
```

Правила:

- отсутствие политики НЕ ломает проект: слоевые проверки просто NOT_CONFIGURED;
- path-паттерны — универсальный fallback; для JS/TS работает настоящий
  import-graph; другие языки подключаются адаптерами;
- лимиты строк — review-сигнал, не автоматический отказ: декларативный словарь
  на 500 строк — не God-файл;
- Repository Intelligence умеет предложить draft policy, но активирует её
  только человек (явный `setPolicy`).

## Module Map

Машиночитаемая карта модулей строится ИНСТРУМЕНТАМИ (policy + структура
каталогов + imports/exports + CODEOWNERS), не LLM:

```json
{
  "modules": [
    {
      "id": "runtime.sessions",
      "patterns": ["plugins/gildra-dsh-runtime/lib/sessions.js"],
      "publicEntrypoints": [],
      "dependsOn": ["runtime.workspaces", "runtime.leases"],
      "owners": ["@runtime-team"],
      "files": 1,
      "lines": 359,
      "fanIn": 2,
      "fanOut": 5
    }
  ]
}
```

LLM может объяснять карту, но рёбра графа приходят из статического анализа.

## Module Change Plan

Task не переходит в `IMPLEMENTING` без структурированного плана:

```json
{
  "modulesToChange": [{ "module": "runtime.sessions", "reason": "review lifecycle" }],
  "newModules": [],
  "publicContractsChanged": [],
  "testsRequired": ["session lifecycle"],
  "risks": ["concurrent transition"]
}
```

Для мелкой правки план короткий (один модуль, одна причина). Фактический diff
сверяется с планом: модуль вне плана → `UNEXPECTED_MODULE_CHANGE`.

## Modularity Analyzer

Не-LLM сигналы поверх diff и import-графа «до/после»:

| Сигнал                                                  | Дефолтный gate |
| ------------------------------------------------------- | -------------- |
| `NEW_DEPENDENCY_CYCLE`                                  | **BLOCK**      |
| `CROSS_LAYER_IMPORT`                                    | **BLOCK**      |
| `DEEP_INTERNAL_IMPORT` (обход publicEntrypoint)         | REVIEW         |
| `UNEXPLAINED_PUBLIC_API_CHANGE`                         | **BLOCK**      |
| `OVERSIZED_MODULE_GROWTH` / `OVERSIZED_FUNCTION_GROWTH` | REVIEW         |
| `NEW_GLOBAL_MUTABLE_STATE`                              | REVIEW         |
| `DUPLICATED_DOMAIN_LOGIC`                               | REVIEW         |
| `MIXED_RESPONSIBILITIES`                                | REVIEW         |
| `UNEXPECTED_MODULE_CHANGE`                              | REVIEW         |
| `ANALYSIS_INCOMPLETE` (обрезанный diff)                 | **BLOCK**      |

BLOCK — блокер readiness до устранения; REVIEW — требует acknowledgment
reviewer'а/человека (fingerprint-привязка, см. ниже). Количество строк само по
себе никогда не блокирует: сигналы контекстные (рост УЖЕ большого файла
несвязанной логикой — HIGH; большой словарь — не сигнал).

## Identity, provenance и anti-forgery

- **Reviewer = capability, не строка.** Review request выдаёт одноразовый
  `reviewerCapability`; submit/resolve принимаются только с ним
  (timing-safe сравнение). Writer-сессия не может подтвердить сама себя,
  подставив имя.
- **Evidence и review привязаны к ревизиям требований**: `taskSpecHash`
  (title+kind+criteria+scope), `qualityPolicyHash`, `architecturePolicyHash`,
  `commandDefinitionHash`. Изменилось любое — старое доказательство и старое
  одобрение становятся STALE.
- **Acknowledgment — по отпечатку сигнала** (`signalFingerprint` +
  `analysisHash` + `headSha`): объяснение вчерашнего TEST_WEAKENING не
  покрывает сегодняшнее. Сигналы TEST_WEAKENING / PROTECTED_AREA_CHANGE /
  SECURITY_CHANGE / DEPENDENCY_CHANGE / PUBLIC_API_CHANGE гасятся только
  reviewer-capability или human-актором.
- **Approved-команда привязана к определению**: `definitionHash` содержимого
  скрипта (`package.json scripts.test`, Makefile-target, …). Изменился скрипт —
  команда снова `discovered`.
- **CI evidence — только структурное**: `commitSha == headSha` +
  `workflowRunId`/`checkSuiteId` + source; произвольный `{"ciStatus":"PASSED"}`
  не принимается; новый коммит протухает CI-доказательство.

## Immutable verification

Verification никогда не выполняется в mutable writer-worktree: на каждый run
создаётся snapshot-worktree `verification/<taskId>/<runId>` на точном
`headSha` (detached), проверки идут там, snapshot удаляется. Dirty-дерево
проверяется только в явном режиме `UNCOMMITTED_SNAPSHOT` с content-хэшем —
никогда не выдаётся за проверку HEAD.

Окружение — allowlist (`PATH HOME TMPDIR LANG LC_ALL CI GILDRA_*` + явные
`verification.allowedSecrets` политики); секреты не пишутся в audit/evidence и
редактируются из хвостов логов. Каждый verification-процесс несёт `runId`:
cancel по runId, один активный run на задачу (если policy не разрешает
параллель), `TIMED_OUT_UNTERMINATED` — честный статус незавершаемого процесса,
старый run не перетирает `latestVerificationId` нового.

## Team Coordination Provider

Координация МЕЖДУ Runtime разных Unix-пользователей — отдельный слой обмена
метаданными, НЕ общий Runtime-state:

```text
publishTaskSummary · publishClaim · releaseClaim · listProjectTasks
listProjectClaims · publishTaskStatus · publishDelivery
```

Backends: `local` (общий каталог; один пользователь, тесты) и `github`
(координационный git-репозиторий, MVP для команды: publish = commit+push,
конкуренция = отказ non-fast-forward → перечитать → повторить, никогда
last-write-wins → `TEAM_STATE_CONFLICT` после лимита повторов).

Разрешено публиковать: projectId, taskId, title, owner, status, branch,
baseSha, claims, affectedModules, expectedAreas, PR number, CI conclusion,
updatedAt, revision. **Запрещено**: ownerToken, capabilities, credentials,
локальные пути workspace, env, PID, логи. Санитизация — allowlist на записи.

## Overlap: три уровня

1. **PATH** — glob-пересечение областей;
2. **MODULE** — обе задачи меняют один модуль карты;
3. **SEMANTIC** — модули разные, но связаны рёбрами import-графа.

Пересечения вычисляются ДО `IMPLEMENTING` по объединению локальных и
командных claims; решение фиксируется явно
(`COORDINATE | CONTINUE | WAIT | TRANSFER_OWNERSHIP`) — молча игнорировать
overlap нельзя. `CLAIMED` предупреждает, `EXCLUSIVE` требует согласования.

## CODEOWNERS и human review

Policy `delivery.requireCodeOwners`: если diff задевает области с владельцами
из CODEOWNERS (или protected areas), readiness требует зафиксированного
human-approval — AI-reviewer обязательного человека не заменяет.

## Рефакторинг без спагетти (правила для самого агента)

characterization test → smallest extraction → verify → continue. Запрещены:
переписывание модуля целиком без нужды, смена публичного API «для красоты»,
`utils.js`-свалки, абстракции без второго использования, перенос кода без
тестового доказательства. Имя модуля обязано называть ответственность.

## Известные ограничения (честно)

- **Глубокий semantic-анализ — только JS/TS** (import-граф по фактическим
  строкам). Другие языки — path-based fallback и адаптеры детекторов; циклов
  и слоёв для них анализатор не видит.
- **GitHub Team Provider — git-репозиторий координации**, не GitHub API:
  комментарии PR, review-requests и статусы читает существующий
  инструментарий агента; провайдер синхронизирует только task/claim-сводки.
  Конфликт после лимита повторов требует ручного решения.
- **«HUMAN»-актор — явный флаг внутри Unix-границы доверия.** Между
  недоверяющими людьми личность по-прежнему разделяют Unix-пользователи;
  крипто-подписей approvals нет и не обещается.
- **Windows process isolation — best-effort** (без Job Objects; см.
  runtime-reliability): TIMED_OUT_UNTERMINATED — честный статус, а не
  гарантия завершения.
- **Human review обязателен** для CODEOWNERS/protected областей и для
  MEDIUM-волны findings по политике проекта — AI-reviewer его не заменяет.
- **Порог ухода с JSON-store** (см. runtime-reliability, «Когда JSON-store
  перестанет подходить») дополняется командными критериями: если понадобится
  shared team state вне git-провайдера или reconciliation нескольких
  коллекций станет регулярной болью — рассматривается SQLite, а не
  дальнейшее превращение JSON-store в самописную СУБД.
