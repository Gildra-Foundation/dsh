# Quality Authority & Team Consistency

Контракт полномочий quality-конвейера: кто и чем доказывает право на
действие. Дополняет [`docs/modularity.md`](modularity.md) и
[`docs/ai-quality.md`](ai-quality.md); граница безопасности неизменна —
**один Unix-пользователь = один security principal**
([`docs/runtime-reliability.md`](runtime-reliability.md)). Всё ниже — защита
processа/конвейера от обхода агентом, а не криптография между недоверяющими
людьми.

## Роли (не взаимозаменяемы)

| Действие                                                       | AI_WRITER |           AI_REVIEWER            | HUMAN_ADMIN | TRUSTED_INTEGRATION |
| -------------------------------------------------------------- | :-------: | :------------------------------: | :---------: | :-----------------: |
| писать код в своём write-workspace                             |     ✓     |                —                 |      —      |          —          |
| запускать verification                                         |     ✓     |                —                 |      —      |          —          |
| запрашивать review                                             |     ✓     |                —                 |      —      |          —          |
| гасить обычные REVIEW-сигналы                                  |     ✓     |                ✓                 |      ✓      |          —          |
| читать immutable review snapshot                               |     —     |                ✓                 |      ✓      |          —          |
| submit findings / вердикт                                      |     —     | ✓ (capability своей read-сессии) |      —      |          —          |
| подтверждать acceptance criteria                               |     —     |                ✓                 |      ✓      |          —          |
| гасить строгие сигналы (TEST_WEAKENING, …)                     |     —     |                ✓                 |      ✓      |          —          |
| менять Quality/Architecture Policy                             |     —     |                —                 |      ✓      |          —          |
| одобрять discovered-команды                                    |     —     |                —                 |      ✓      |          —          |
| CODEOWNERS / protected-override / incomplete-analysis override |     —     |                —                 |      ✓      |          —          |
| настраивать Team Provider                                      |     —     |                —                 |      ✓      |          —          |
| передавать CI evidence                                         |     —     |                —                 |      —      |          ✓          |
| объявлять себя человеком                                       |     —     |                —                 |     n/a     |          —          |

## Capability lifecycle (единый для всех ролей)

Каждая capability: `scope` (действие), `entityId` (task/review/project),
`issuedAt`, `expiresAt`, `usedAt` (одноразовые), `revokedAt`, `generation`.
В state хранится ТОЛЬКО SHA-256-хэш; сравнение — timing-safe. Значения не
попадают в audit, diagnostics, Team Provider, review packet, логи и тексты
ошибок. Повтор, истечение, отзыв, чужая сущность, чужая роль, старый HEAD и
старая policy-ревизия — отказ.

## Review flow

```text
Writer → requestReview(reviewerSessionId)
  Runtime: reviewer-сессия существует · mode == READ · не сессия writer'а ·
           тот же проект · БЕЗ write-lease
  Runtime: создаёт immutable review snapshot review/<taskId>/<reviewId>/<sha>
  Writer получает ТОЛЬКО reviewId и публичный статус
Reviewer → claimReview(reviewId, ownerToken своей read-сессии)
  Runtime выдаёт reviewerCapability ТОЛЬКО держателю этой сессии
Reviewer читает snapshot → submitReview(capability)
  Проверяются: capability ↔ reviewerSessionId ↔ review request ↔ snapshotSha ↔
  ревизии постановки и политики
```

Имя `reviewerAgent` — метка для людей; личность доказывает только capability,
доставленная через владение read-сессией. Новый writer-commit протухает
review; повторный цикл — новый request и новый snapshot.

## Human approval flow

`{"human": true}` не является доказательством. Человеческое действие проходит
через интерактивный канал приложения:

```text
Пользователь подтверждает действие в UI
→ Desktop Host / permission layer вызывает привилегированный issue-канал
  Runtime (НЕ маршрут /gildra/v1 — у AI-инструментов его нет)
→ Runtime выдаёт одноразовую HumanActionCapability
  {action, projectId/taskId, headSha, expiresAt}
→ capability предъявляется ровно один раз нужному endpoint'у
```

Требуется для: изменения Quality/Architecture Policy, одобрения команд,
CODEOWNERS approval, protected-override, override неполного анализа,
настройки Team Provider.

## Trusted CI

Endpoint CI-evidence принимает данные только с capability
`TRUSTED_INTEGRATION:<provider>`, выданной тем же привилегированным каналом
при настройке интеграции. Структура остаётся обязательной: `commitSha ==
HEAD задачи`, `workflowRunId`, `conclusion`; новый commit протухает evidence.
Серверная перепроверка через GitHub API — задокументированное будущее
(вариант B), недоступное в offline-окружениях.

## Team consistency

`team.mode`: `solo` (провайдера нет) · `best-effort` (сбой синхронизации →
DEGRADED в state/UI/audit, работа продолжается) · `strict` (без успешной
публикации claims и чтения командного состояния Task не переходит в
IMPLEMENTING: `TEAM_SYNC_REQUIRED`/`TEAM_SYNC_DEGRADED`). Для командных
проектов рекомендован `strict`. Overlap-decision привязан к отпечатку
пересечения (claims + планы + ревизии чужих задач): новая задача, чужая или
своя claim, новый план или восстановившийся провайдер с новыми данными →
`STALE_OVERLAP_DECISION`, решение принимается заново. Git-провайдер
сериализует все операции одного clone локальным mutex'ом.

## Известные ограничения (честно)

- Внутри одного Unix-пользователя абсолютной защиты от самого себя нет:
  процесс с правами пользователя может читать state. Capability-модель
  защищает КОНВЕЙЕР от обхода агентом через штатные каналы, и это её честная
  граница.
- Human confirmation опирается на Desktop Host/permission layer; на headless
  сервере привилегированный канал — это доступ к Runtime-процессу самого
  Unix-пользователя.
- TRUSTED_INTEGRATION проверяет ПРЕДЪЯВИТЕЛЯ, а не пересчитывает CI у GitHub.
- Git Team Provider — MVP; semantic-анализ глубоко — только JS/TS; JSON-store
  single-host; Windows-завершение процессов best-effort.
