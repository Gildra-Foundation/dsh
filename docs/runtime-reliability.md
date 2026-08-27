# Gildra Runtime: надёжность, конкуренция и восстановление

Этот документ — контракт надёжности серверного слоя
`plugins/gildra-dsh-runtime`. Он отвечает на главный вопрос: может ли Runtime
безопасно переживать реальную конкуренцию процессов, падения, потерю
heartbeat, частично выполненные Git-операции, reconnect, stale state и
необычный/недоверенный Git-репозиторий — не повреждая работу других сессий.

## Аудит перед hardening (независимая ревизия)

| Area | Finding | Severity | Fix |
| --- | --- | --- | --- |
| Git env | `git()` слепо наследует весь `process.env`, включая `GIT_DIR`/`GIT_WORK_TREE`/`GIT_CONFIG*`, которые перенаправляют managed-команду в чужой репозиторий | **High** | `gitSafeEnv` + `-c core.hooksPath=…` |
| Git hooks | worktree/merge исполняют hooks недоверенного репо | **High** | отключены флагами на всех managed-командах |
| Lease ABA | «воскресший» writer после takeover мог финализировать destructive-операцию | **High** | fencing `generation` в durable-счётчике |
| Crash consistency | многошаговые create/merge/cleanup без журнала: recovery гадает | **High** | durable operation journal + reconciliation |
| API origin | принимался запрос без `Origin` (не-браузерный) к мутациям; нет строгого allowlist | **Med** | строгий same-origin allowlist loopback |
| Token compare | сравнение ownerToken не constant-time; токен мог попасть в текст ошибки | **Med** | `timingSafeEqual` + вычистка из ошибок/audit |
| Idempotency | повтор POST create → дубль сессии | **Med** | `Idempotency-Key` со временем жизни |
| Merge base | старый base считался текущим молча | **Med** | `baseCommit` (immutable) + ahead/behind target |
| Cleanup TOCTOU | между dry-run и delete состояние менялось | **Med** | re-check blockers под локом @generation |
| Git timeout | локальные и сетевые команды с одним большим таймаутом; fetch мог зависнуть | **Med** | раздельные таймауты + retry/backoff у fetch |
| Store durability | нет fsync файла/каталога; сбой после write до rename оставлял temp | **Med** | fsync file+dir, очистка temp |
| Project adopt | принимался произвольный путь; не проверялся тип/симлинк/вложенность | **Med** | серверная проверка adopt + realpath |
| Runtime lifecycle | mutation API принимался до reconciliation | **Med** | BOOTING→RECOVERING→READY gate |
| Audit growth | JSONL рос без ротации; риск утечки env/токенов | **Low** | ротация + allowlist полей |
| Limits | не было per-session лимитов процессов/портов | **Low** | structured `LIMIT_EXCEEDED` |

## Модель безопасности (граница доверия)

**Один Unix-пользователь = один security principal.** `ownerToken` — это
capability сессии (concurrency-токен внутри доверенной зоны одного
пользователя), а НЕ граница безопасности между разными людьми. Два человека,
которые не доверяют друг другу, изолируются двумя Unix-пользователями и/или
двумя Runtime — не токенами внутри одного процесса Harness. API слушает только
loopback; мутации требуют same-origin и capability сессии.

## Модель конкуренции

Runtime — **single-host, multi-process** координатор поверх файловой системы.
Конкуренция бывает трёх видов, и для каждого — свой примитив:

| Вид | Примитив | Где |
| --- | --- | --- |
| Взаимное исключение операции (fetch, аллокация порта, критическая секция) | `JsonStore.withLock` — атомарный `mkdir` + reaper-перехват мёртвого владельца | store.js |
| Единственный писатель в worktree | Lease: атомарный `mkdir` + owner-token + **generation** (fencing) | leases.js |
| Атомарность чтения-модификации-записи одной записи | temp-write + `rename` (+ fsync где поддерживается) | store.js |

Все mkdir-локи перехватывают только доказуемо мёртвого владельца и только под
вторичным reaper-мьютексом с перепроверкой — чтобы два претендента не удалили
один и тот же свежий лок (ABA на уровне каталога). Живой владелец, пусть даже
с протухшим heartbeat, не выселяется автоматически никогда.

## Fencing (защита от «воскресшего» писателя)

Сценарий ABA: старый писатель завис → его lease признан ORPHANED → новый
писатель получил lease → старый внезапно продолжил. Prompt-guard тут
недостаточен. Защита: у каждого lease есть монотонный **generation**, который
инкрементируется при каждом новом захвате/перехвате (в durable-счётчике
`state/leasegen/<workspaceId>.json`, переживающем удаление самого lease).
Managed-destructive-операции Runtime (cleanup, merge-финализация, снятие
lease) проверяют, что предъявленный fencing-token соответствует текущему
поколению; устаревший токен получает `FOREIGN_OWNER`/`WORKSPACE_LOCKED` и не
делает ничего. Это защищает Runtime-managed операции; произвольную запись
файлов «воскресшего» процесса на уровне ФС Runtime не перехватывает — граница
остаётся worktree-isolation (см. «Известные ограничения»).

## Три вида heartbeat

Закрытие вкладки браузера ≠ смерть агента. Разделены:

- **UI heartbeat** — вкладка открыта; поддерживает lease живым, но его
  отсутствие само по себе НЕ делает сессию ORPHANED.
- **Process heartbeat** — жив ли зарегистрированный за сессией процесс (PID
  Runtime, породивший сессию, или managed-процессы).
- **Lease heartbeat** — свежесть `heartbeatAt` в meta lease.

Сессия признаётся ORPHANED только когда мёртв процесс-владелец **и** молчит
lease дольше жёсткого порога **и** нет живых managed-процессов сессии.

## Durable operation journal

Опасные многошаговые операции (создание сессии, cleanup, merge, recover,
клонирование/adopt проекта) записывают durable-журнал в
`state/journal/<operationId>.json` с фазами:

```json
{ "operationId": "...", "type": "CREATE_SESSION", "entityId": "...",
  "phase": "WORKTREE_CREATED", "startedAt": "...", "updatedAt": "..." }
```

Журнал позволяет recovery не гадать, а точно знать, какой шаг завершился. При
старте незавершённые записи классифицируются и безопасно доводятся до конца
или откатываются; ничего пользовательского не удаляется автоматически.

## State machine

```text
Session:  CREATING → ACTIVE → {IDLE,TESTING,REVIEWING,MERGING} → CLEANING → COMPLETED
                        │                                             │
                        └────────────→ ORPHANED ←───────────────────┘  (crash)
                                          │  recover
                                          └──────────→ ACTIVE
          (создание при сбое → FAILED)

Lease:    FREE → ACTIVE ⇄ STALE(heartbeat протух, владелец жив) → ORPHANED(владелец мёртв) → (takeover) → ACTIVE'(generation+1)

Merge:    PREPARING → MERGING → {COMPLETED | CONFLICT → (resolve) → COMPLETED | ABORTED} ; сбой → FAILED
          target-ветка двигается ТОЛЬКО последним атомарным шагом finalize.

Cleanup:  plan(generation) → execute(under lock, re-check blockers @generation) → deleted
          blockers: ACTIVE_LEASE | DIRTY_WORKTREE | UNMERGED_COMMITS | LIVE_PROCESSES
```

## Runtime startup lifecycle

```text
BOOTING → RECOVERING (reconcile state ↔ worktrees ↔ git ↔ processes) → READY
                                                              └→ DEGRADED (повреждён critical state/canonical repo)
```

Мутационный API отклоняется до `READY` (503 `RUNTIME_NOT_READY`); read-only
`/gildra/v1/health` доступен всегда.

## Crash-recovery: точка сбоя → ожидаемое восстановление

| Точка сбоя | Что на диске | Восстановление |
| --- | --- | --- |
| После создания ветки, до worktree | branch есть, worktree нет, state нет | journal(`BRANCH_CREATED`) → удалить осиротевшую ветку, операция FAILED |
| После worktree, до записи state | worktree есть, state нет | journal → зарегистрировать (adopt) или откатить по выбору; reconciliation помечает `untrackedWorktrees` |
| После state, до lease | state ACTIVE, lease нет | recovery: сессия ORPHANED → Recover перехватывает lease |
| Merge: сбой в конфликте | merge-worktree с маркерами, target не двинут | journal(`CONFLICT`) → пользователь resolve/abort; target нетронут |
| Merge: сбой после finalize-коммита, до удаления worktree | target двинут, merge-worktree остался | reconciliation чистит orphan merge-worktree; результат уже в target |
| Cleanup: сбой между проверкой и удалением | частично удалён worktree | повторный cleanup идемпотентен; journal(`CLEANING`) доводит до конца |
| Повреждён critical JSON (session/workspace) | `.corrupt-*` отложен | НЕ создавать пустой state поверх worktree; reconciliation scan предлагает Recover |

## Git-безопасность

Клонируемый/adopt-репозиторий недоверен. Все managed git-команды идут через
контролируемое окружение (`gitSafeEnv`): опасные `GIT_*` (`GIT_DIR`,
`GIT_WORK_TREE`, `GIT_CONFIG*`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`,
`GIT_TEMPLATE_DIR`, `GIT_HOOKS_PATH`, `GIT_PROXY_COMMAND`, `GIT_EXTERNAL_DIFF`,
`GIT_PAGER`, …) вычищаются из унаследованного env. Важное уточнение: `GIT_SSH_COMMAND`,
`GIT_ASKPASS` и `SSH_AUTH_SOCK` СОХРАНЯЮТСЯ — это собственные настройки
пользователя внутри его же Unix-аккаунта, а не влияние недоверенного
репозитория; ломать ими аутентификацию незачем, зависания закрывает таймаут.
Флаги `-c core.hooksPath=<empty> -c core.fsmonitor=false -c protocol.ext.allow=never`
+ `GIT_TERMINAL_PROMPT=0` не дают репозиторию заставить Runtime выполнить
произвольный helper/hook. SSH host-verification НЕ ослабляется. Аутентификация
пользователя (`GIT_SSH`, ssh-agent, git credential helper, настроенные им явно)
сохраняется — вычищается только «repository-control» слой. Все команды имеют
таймаут (локальные короче сетевых); fetch — ограниченные retry с backoff, но не
на auth-ошибку; при таймауте — `GIT_TIMEOUT`, при отсутствии auth —
`GIT_AUTH_REQUIRED`. Минимальная версия git (worktree стабильны с 2.17)
проверяется в self-check.

## Известные ограничения (честно)

- **Single-host.** JSON-store и mkdir-локи координируют только процессы одного
  хоста и одного пользователя. Cross-host lease не существует; двум серверам
  общий canonical-репозиторий по сети не отдаётся.
- **Unix-пользователь обязателен для изоляции людей.** `ownerToken` не
  изолирует недоверяющих людей внутри одного Harness (см. модель безопасности).
- **Windows process isolation — best-effort** (`taskkill /T`), без Job Objects;
  абстракция `ProcessBackend` подготовлена, нативного addon нет.
- **Fencing защищает Runtime-managed destructive операции**, а не произвольную
  запись файлов «воскресшим» процессом; на уровне ФС основная защита —
  worktree-isolation и OS-права.
- **Git guard уровня shell-строки не абсолютен**; основная защита от опасных
  git-команд агента — worktree-isolation, guard — дополнительный слой.
- **Filter-драйверы недоверенного локального репозитория.** `git clone` не
  переносит config и hooks с удалённой стороны, поэтому клонированный проект
  безопасен. Но у ADOPT-нутого локального репозитория в его собственном
  config может быть объявлен `filter.<name>.smudge`, который git выполнит при
  checkout worktree. Отключить фильтры «оптом» git не умеет (нужно знать имя),
  поэтому остаточный риск закрыт организационно: adopt — явное действие
  пользователя над репозиторием, который у него уже на диске.
- **Идемпотентность запросов — в памяти процесса.** Кэш `Idempotency-Key`
  живёт до перезапуска Runtime и ограничен по TTL/размеру: он защищает от
  ретрая клиента, а не заменяет durable-состояние.
- **Windows: идентичность процесса не проверяется вне процесса-родителя.**
  `StartTime` доступен только через PowerShell/wmic (отдельный процесс на
  каждую проверку), поэтому там работает связка «живой хендл + taskkill /T».
