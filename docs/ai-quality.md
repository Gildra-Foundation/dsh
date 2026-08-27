# AI Engineering Quality Pipeline

Контракт слоя качества Gildra Runtime: как ИИ-агент проходит путь от задачи до
`READY_FOR_HUMAN_REVIEW`, почему он не может объявить работу готовой словами и
как несколько людей и агентов работают над одним репозиторием, не мешая друг
другу. Слой построен ПОВЕРХ существующего Runtime (worktree-изоляция, lease,
журнал операций, Process Manager) и не добавляет новых внешних зависимостей.

## Продуктовая модель

Единица инженерной работы — Task, а не чат. Чат остаётся интерфейсом.

```text
Task → Repository Understanding → Impact/Scope → Isolated Workspace
     → Implementation → Verification (evidence) → Independent Review
     → Fix Findings → Re-Verification → Upstream check → PR/Delivery
     → READY_FOR_HUMAN_REVIEW → Human merge
```

Статус `READY_FOR_HUMAN_REVIEW` не назначается — он ВЫЧИСЛЯЕТСЯ из evidence
(Definition of Done). Ни агент, ни API-вызов не могут поставить его напрямую.

## Модули

| Модуль | Ответственность |
| --- | --- |
| `lib/globs.js` | Единый glob-матчинг (`**`, `*`, `?`) для scope, claims, protected areas, CODEOWNERS |
| `lib/repo-intel.js` | Repository Profile: детекторы языков, package-менеджеров, команд, policy-файлов, CI, generated-файлов, ADR; парсер CODEOWNERS; уровни доверия команд |
| `lib/quality.js` | Quality Policy проекта, verification-запуски через Process Manager, Verification Evidence, Definition of Done (readiness) |
| `lib/diff-analyzer.js` | Структурный разбор diff: файлы/строки, зависимости, ослабление тестов, опасные паттерны, scope, generated |
| `lib/review.js` | Структурное независимое ревью: findings, gate, writer ≠ reviewer, adversarial-триггер |
| `lib/claims.js` | Work Claims и обнаружение пересечений (path + import-соседи) |
| `lib/upstream.js` | Сдвиг цели относительно baseSha и его релевантность задаче |
| `lib/context-builder.js` | Компактный Task Context для writer/reviewer |

Всё — `node:`-модули (инвариант локальных плагинов), состояние — существующий
JSON-store, долгие команды — существующий Process Manager, длинные логи — в
файлах, не в JSON-state.

## Repository Intelligence

Профиль строится из ЗАКОММИЧЕННОГО состояния репозитория (`git ls-tree` +
`git show <sha>:<path>`), а не из грязного worktree, и кэшируется по
`projectId + commit`. Система детекторов расширяемая: каждый детектор получает
список файлов и функцию чтения файла, возвращает свой фрагмент профиля.

```json
{
  "projectId": "…", "commit": "…",
  "languages": ["javascript", "shell"],
  "packageManagers": ["npm"],
  "commands": { "discovered": [{ "id": "test", "argv": ["npm", "test"], "source": "package.json" }] },
  "policyFiles": ["AGENTS.md", "CONTRIBUTING.md"],
  "architectureDocs": ["docs/architecture.md"],
  "adrDirs": ["docs/adr"],
  "ciWorkflows": [".github/workflows/ci.yml"],
  "generatedFiles": ["plugins/gildra-dsh-ui-compact/lib/client.js"],
  "owners": { "rules": [{ "pattern": "docs/**", "owners": ["@alex"] }] }
}
```

### Доверие к командам (три уровня)

| Уровень | Что это | Выполняется? |
| --- | --- | --- |
| `discovered` | Найдено детектором в файлах репозитория | **Нет.** Репозиторий недоверенный: команда из README/package.json — данные, не приказ |
| `approved` | Пользователь явно одобрил discovered-команду через API | Да |
| `trusted` | Команда из явной Quality Policy проекта (задана пользователем) | Да |

Команды хранятся и передаются ТОЛЬКО как argv-массивы — `shell: true` не
используется нигде. Никакая строка из файлов репозитория не исполняется без
явного одобрения пользователя.

## Quality Policy и Definition of Done

Policy проекта (не привязана к npm — любой стек):

```json
{
  "required": ["tests", "lint", "review"],
  "checks": {
    "tests": { "argv": ["npm", "test"], "timeoutMs": 600000 },
    "lint": { "argv": ["npm", "run", "lint"] }
  },
  "reviewGate": { "blocking": ["BLOCKER", "HIGH"] },
  "protectedAreas": [".github/workflows/**"],
  "highRiskAreas": ["install/**"]
}
```

Definition of Done для перехода Task в `READY_FOR_HUMAN_REVIEW`:

```text
✓ у задачи есть acceptance criteria
✓ workspace чист, evidence.headSha == текущий HEAD ветки (свежее доказательство)
✓ каждый required-check в статусе PASSED (ненастроенный check = NOT_CONFIGURED, не PASSED)
✓ независимое ревью: APPROVED, reviewer ≠ writer
✓ 0 непогашенных BLOCKER/HIGH findings (порог настраивается per-project)
✓ каждый критерий приёмки подтверждён reviewer'ом
✓ все сигналы diff-анализа (TEST_WEAKENING, UNEXPECTED_CHANGE, PROTECTED_AREA_CHANGE,
  DEPENDENCY_CHANGE, GENERATED_FILE_EDIT) либо отсутствуют, либо явно объяснены
✓ high-risk diff дополнительно прошёл adversarial review
✓ для bugfix: regression-доказательство (проваленный прогон → прошедший прогон)
  или зафиксированный MANUAL_REPRO_ONLY с причиной
✓ upstream: цель не уехала релевантно, либо сдвиг явно рассмотрен
```

Проверка не настроена → `NOT_CONFIGURED` и честно видна; required, но не
настроена → блокирует. Искусственного «quality score 93/100» нет — UI
показывает факты.

## Verification Evidence

Каждый прогон верификации — durable-запись:

```json
{
  "runId": "…", "taskId": "…", "headSha": "…", "dirtyAtRun": 0,
  "checks": [
    { "id": "tests", "argv": ["npm", "test"], "status": "PASSED",
      "exitCode": 0, "durationMs": 41000, "logPath": "state/logs/…", "logTail": "…" }
  ]
}
```

Статусы check: `PASSED | FAILED | NOT_CONFIGURED | CANCELLED | TIMED_OUT`.
Команды запускаются существующим Process Manager (регистрация, лимиты,
cancellation через terminate), stdout/stderr пишутся в отдельный лог-файл;
в state хранится только хвост. Отмена не удаляет workspace.

Evidence протухает: новый коммит в ветке делает `headSha` несвежим, и
readiness требует новый прогон. «Тесты проходили вчера» — не доказательство.

## Независимое ревью

Writer никогда не финальный reviewer: `reviewerAgent !== writerAgent`
проверяется Runtime (`WRITER_REVIEWER_CONFLICT`). Reviewer работает в
отдельной read-сессии без write-lease.

Findings машинно-структурированы:

```json
{ "severity": "HIGH", "category": "CORRECTNESS", "file": "src/foo.js",
  "line": 120, "message": "…", "evidence": "…" }
```

Severity: `BLOCKER | HIGH | MEDIUM | LOW | NIT`. Categories: `CORRECTNESS |
SECURITY | CONCURRENCY | DATA_LOSS | ARCHITECTURE | BACKWARD_COMPATIBILITY |
PERFORMANCE | TESTING | MAINTAINABILITY`. Gate по умолчанию: BLOCKER/HIGH
блокируют, MEDIUM — предупреждение, LOW/NIT — нет; настраивается per-project.
Reviewer получает: задачу, критерии, policy, diff, evidence и сигналы
diff-анализа — но не всю историю рассуждений writer.

Adversarial review добавляется автоматически, когда diff касается high-risk
областей (concurrency/security/git/installer/updater/... — настраивается);
обычная CSS-правка второй режим не запускает.

## Diff Analyzer (не-LLM сигналы)

Работает по `git diff baseSha..HEAD` и анализирует только сами изменения:

- зависимости: добавленные/удалённые/изменённые в манифестах пакетов, lockfile → `DEPENDENCY_CHANGE`;
- ослабление тестов: удалённые тест-файлы, чистая потеря ассертов, `.only`/`.skip`,
  выключенный lint/typecheck, catch-and-ignore → `TEST_WEAKENING`;
- опасные паттерны (расширяемый список): `shell: true`, `chmod 777`,
  `StrictHostKeyChecking=no`, insecure TLS, … — это reviewer-сигналы, а не
  универсальный security-сканер;
- scope: фактические файлы против `expectedAreas` → `UNEXPECTED_CHANGE`
  (`SCOPE_EXPANDED` на Task); protected areas → `PROTECTED_AREA_CHANGE`;
- generated-файлы, отредактированные вручную → `GENERATED_FILE_EDIT`;
- API-поверхность (MVP для JS): изменённые `export`-строки → `BACKWARD_COMPATIBILITY_REVIEW`.

Каждый сигнал требует либо отката, либо явного объяснения
(acknowledgment записывается на Task) — молча сигнал не гасится.

## Team Work Claims

Worktree защищает файлы физически; claims добавляют ЛОГИЧЕСКУЮ координацию:

- Task заявляет области (`src/auth/**`) в режиме `SHARED | CLAIMED | EXCLUSIVE`
  (дефолт `CLAIMED`);
- пересечение с чужой задачей → предупреждение с деталями (кто, какая область);
  EXCLUSIVE-конфликт блокирует до явного решения; CLAIMED — только warning;
- семантический уровень (MVP, без LLM): если изменённые файлы двух задач
  связаны import-графом в 1 шаг → `RELATED_WORK_WARNING`.

Claims — механизм кооперации, не файловый lock: физическая защита остаётся
за worktree + lease.

## Upstream Awareness

База задачи закреплена immutable `baseSha`. Runtime по запросу сравнивает её с
текущей целью: `git diff --name-only baseSha..target` пересекается с
(expectedAreas ∪ изменённые файлы ∪ import-соседи) →
`UP_TO_DATE | UPSTREAM_UNRELATED | UPSTREAM_RELEVANT`. Автоматический rebase
не выполняется никогда — Runtime рекомендует, действие принимает человек/агент.

## Task Context Builder

Собирает КОМПАКТНЫЙ контекст (identity workspace + критерии + expected scope +
trusted-команды + пути relevant policy-файлов и ADR по затронутым областям +
предупреждения claims/upstream + Definition of Done). Не подмешивает: весь
git-history, все docs, чужие задачи, полный README. Project Memory — это
профиль, policy и одобренные команды; Task Memory — план, критерии, findings,
acknowledgments на самой задаче. Дампы чатов в память не пишутся.

## Delivery: PR и CI

Для team-проектов рекомендуемая доставка — PR. Runtime хранит delivery-состояние
задачи: `{ mode: PR|LOCAL_MERGE, branchPushed, prUrl, prNumber, ciStatus,
ciFixAttempts }`; падение CI переводит задачу в failureKind `CI` и ограничивает
число auto-fix итераций (по умолчанию 3), бесконечного CI-цикла нет. Сетевые
операции GitHub (создание PR, чтение checks и review-комментариев) выполняет
существующий GitHub-инструментарий агента; Runtime намеренно НЕ содержит
GitHub-клиента, сетевых вызовов и credentials — он валидирует и хранит факты,
которые ему сообщают, и вычисляет readiness. Human-комментарий не помечается
resolved без фактического изменения/ответа — resolved-статус приходит только
с внешнего ревью.

## Жизненный цикл Task

```text
PLANNED → IMPLEMENTING → VERIFYING → REVIEWING → FIXING_REVIEW
        ↘ BLOCKED / CANCELLED         ↓        ↗ (новые findings)
                                  READY_FOR_HUMAN_REVIEW → MERGED
FAILED(failureKind: IMPLEMENTATION | VERIFICATION | REVIEW | CI | MERGE_CONFLICT)
```

Без state explosion: детали (какой именно check упал, чем заблокирован)
живут в evidence/`blockReason`/`failureKind`, а не в новых статусах.
`READY` больше не существует как назначаемый статус.

## Границы безопасности (наследуются)

- Один Unix-пользователь = один security principal; claims и review —
  кооперация внутри доверенной зоны, не защита от злонамеренного коллеги.
- Команды верификации — только trusted/approved argv; произвольный shell через
  API не выполняется по-прежнему.
- Логи верификации не содержат env и токенов Runtime (env процесса —
  session-окружение без секретов Runtime).
