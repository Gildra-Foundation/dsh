# Аудит Gildra DSH: архитектура, качество, производительность, AI-пригодность

Первичный аудит: 26 августа 2026 (кандидат 0.1.15, ~11 тыс. строк собственного кода).
**Статусы актуализированы: 27 августа 2026** — после серии исправлений `ca4a01d…0e0d61b`
(перепроверка каждого пункта по фактическому коду, затем целевые фиксы; полный
`./scripts/verify.sh` зелёный, 7/7 тест-сьютов, включая новые поведенческие DOM-тесты).

Легенда статусов: **CONFIRMED** — подтверждено перепроверкой; **FIXED** — исправлено
(указан коммит); **PARTIALLY FIXED** — закрыта часть; **REJECTED** — перепроверка
опровергла; **OBSOLETE** — утверждение устарело; **NEEDS WINDOWS/MACOS/LINUX
VERIFICATION** — код исправлен, нужен прогон на реальной платформе.

---

## 0. Перепроверка аудита (этап 1)

| Пункт | Вердикт перепроверки |
| --- | --- |
| C1 Windows updater (`-Command`/`$args`) | CONFIRMED → **FIXED** `7c1c515` |
| C2 Windows installer (нет `$LASTEXITCODE`) | CONFIRMED → **FIXED** `204c28d` |
| C3 UI render loop | CONFIRMED (уточнение: observer слушает childList+characterData, петлю питали именно text-записи) → **FIXED** `32aac10` |
| `applyUpdate()` без тестов | CONFIRMED → **FIXED** `f6f7861` (9 сценариев) |
| Linux installer в CI только `bash -n` | CONFIRMED → **FIXED** `af6f542` |
| Regex-only UI-тесты | CONFIRMED → **PARTIALLY FIXED** `f7a7174`+`0e0d61b` (поведенческие DOM-тесты добавлены; регекс-инварианты сохранены осознанно) |
| Supply-chain хеши (DSH source/CodeGraph без SHA) | CONFIRMED как факт; фиксация SHA codeload-архивов **REJECTED как метод** (GitHub не гарантирует байт-стабильность) → честная модель доверия задокументирована `4db6afd` |
| GitHub Actions pinning | **ALREADY FIXED** ещё в кандидате (SHA-пины + guard в verify.sh); guard усилен до запрета любых не-SHA ref `4db6afd` |
| Installer parity (дрейф трёх установщиков) | CONFIRMED; часть закрыта (`6bd0542` guard, `c44e2b1` runtime/python), унификация — открыта |
| Параллельный запуск updater | CONFIRMED → **FIXED** `e9f9cea` |
| SSH reconnect behaviour | **PARTIALLY REJECTED**: фоновое подключение — задокументированная фича README, дефект только в бесконечных быстрых ретраях → backoff `aee1d23` |

---

## 1. Вердикт (после исправлений)

Ядро осталось сильным (SSOT-манифест, трёхслойная архитектура, guard-тесты), а
три критических дефекта и большинство high-находок закрыты доказуемо: Windows-пути
установки/обновления падают честно и покрыты failure-path smoke в CI, вечная
рендер-петля устранена и поведенчески доказана DOM-тестами, рискованные пути
(applyUpdate, симлинк-защита) впервые покрыты исполняемыми тестами, Linux-установщик
исполняется в CI целиком.

### Оценки: было → стало

| Область | Было | Стало | Комментарий |
| --- | --- | --- | --- |
| Документация | 8 | 8,5 | + модель доверия загрузок, живой аудит; личные данные убраны |
| Архитектура | 7,5 | 8 | client.js стал generated из 20 модулей с детерминированной сборкой |
| Supply chain / безопасность | 7 | 8 | fd-чтение в патче, commit-пин скиллов, guard не-SHA ref, честная модель доверия |
| Качество кода | 6,5 | 7,5 | идемпотентный рендер, строгий stop, локи, ESLint-чистота |
| AI-пригодность | 5,5 | 7,5 | AGENTS/CLAUDE.md + скиллы (были добавлены до этой серии), npm test/lint, generated-клиент |
| Тестовое покрытие | 4,5 | 7 | applyUpdate 9 сценариев, симлинк-матрица, DOM-поведение, lock; дыры: configure-profile, fleet-sync сбои |
| Надёжность установки/обновления | 4 | 7,5\* | \*код исправлен и покрыт CI-smoke; звёздочка до прогона на реальной Windows |
| Производительность (runtime) | 4 | 7,5 | петля устранена (доказано), 500-мс поллинг убран, SSH-backoff; TreeWalker-проходы по мутациям остались |

---

## 2. Критические дефекты

### C1. Самообновление на Windows неработоспособно — **FIXED** `7c1c515` · NEEDS WINDOWS VERIFICATION

`scripts/gildra-update.mjs` — `powershell.exe -Command '…$args[0]…'` не заполняет
`$args`. Исправлено: все вызовы идут через временный `.ps1` + `-File` с
аргументами отдельными argv; фильтр процессов — литеральный `.Contains` вместо
`-like` (плюс `[]`-wildcard-ловушка), guard пустого needle с обеих сторон,
`validateStopTarget` (только `bin.js` внутри install root). Остановка стала
строгой: таймаут → ошибка, а не установка поверх живого приложения; `osascript
quit` больше не запускает закрытое приложение. Покрыто юнит-тестами
(инварианты скриптов, argv, temp-файл) и сценариями applyUpdate.

> Ловушка «наивного фикса» (`-like "**"` → Stop-Process по всем процессам)
> нейтрализована именно переходом на `.Contains` + guard; зафиксирована тестом
> `assert.doesNotMatch(script, /-like/)`.

### C2. Windows-установка фиксировала провал как успех — **FIXED** `204c28d` · подтверждено CI-smoke на windows-2025

`install/windows-install.ps1` — PowerShell 5.1 не превращает exit-коды exe в
ошибки. Исправлено: `Invoke-Checked` (проверка `$LASTEXITCODE` + throw) вокруг
corepack/pnpm install/pnpm build/configure-profile; маркер `.gildra-kit-version`
недостижим при ошибке; `.cmd`-обёртки сохраняют код возврата через `pause`.
CI-smoke (`efa1d9b`) инжектирует сбой нативной команды через задокументированный
`GILDRA_DSH_TEST_FAIL_MATCH` и проверяет: установка падает, маркер не появляется,
битый stage не становится source.

### C3. Вечная рендер-петля в UI — **FIXED** `32aac10`, доказано `0e0d61b`

Уточнение механики: observer слушает `childList+characterData`, и mutation
record ставится даже при записи прежнего значения — петлю питали безусловные
`textContent`-записи. Исправлено идемпотентными DOM-помощниками (`setText`/
`setAttr`/`setDataset`/`setClass`/`setHidden`/`setStyleProperty`/`setTitle`/
`applyTranslatedNodeValue`) во всех горячих функциях + signature-skip пересборки
переключателя сред. Доказательство: DOM-тест — три повторных прохода по
неизменному состоянию не меняют ни байта разметки и не пересоздают текстовые
узлы; плюс инвариант «горячие функции без голых записей» в test.mjs.

---

## 3. Высокий приоритет — статусы

### Обновление и установка

- **FIXED** `d3d0aa9` — CI маскировал ошибки парсинга PowerShell (`[ref]$errors`
  перезаписывался; в release.yml парсился один файл). Теперь ошибки
  аккумулируются по всем `install/*.ps1` в обоих workflow.
- **CONFIRMED (open, смягчено)** — недокументированный контракт standalone-копий
  `gildra-update.mjs`/`sync-server-fleet.mjs`: описан в AGENTS.md (инварианты) и
  в скилле; машинного guard в verify.sh пока нет.
- **CONFIRMED (open)** — `run()` c `shell: true` без квотирования
  (`scripts/kit-config.mjs`) ломает установку при пробеле в пути Windows-профиля.
- **FIXED** `b2a39b8` — обход sentinel-преаудита: `pluginsMissingFromLock` теперь
  требует пару «имя пакета + specifier» (тест на кейс совпадающей чужой версии).
- **FIXED** `e9f9cea` — эксклюзивный лок обновления: атомарный mkdir + meta{pid},
  stale-takeover через rename, release не трогает чужой живой лок; тесты
  (контенция, stale, orphan, чужой лок).
- **FIXED** `7c1c515` — остановка приложения строгая (см. C1).
- **CONFIRMED (open)** — релизное .app с ad-hoc подписью блокируется Gatekeeper
  после скачивания; нужна нотарификация либо принудительно-локальная сборка.
- **REJECTED как метод / задокументировано** `4db6afd` — SHA-256 для
  codeload-архивов DSH/CodeGraph: GitHub не гарантирует байт-стабильность
  архивов, фиксация хеша ломала бы установки. Честная модель доверия — в
  SECURITY.md; пин по commit остаётся.
- **CONFIRMED (open, задокументировано)** — 8 git-tarball-плагинов без
  `integrity` в lock (SECURITY.md, сноска ²).

### Клиентский слой

- **FIXED** `f151c1b` — переводы применялись при явном English: DOM-словари
  отключаются при явно выбранном English (до выбора — прежнее поведение);
  покрыто DOM-тестом.
- **PARTIALLY FIXED** `aee1d23` — фоновый авто-SSH: сама фича задокументирована
  в README (переклассифицировано), дефект был в бесконечных ретраях каждые 8 с —
  теперь экспоненциальный backoff 8с→5мин со сбросом при успехе.
- **FIXED** `238c044` — `.remove()` React-узла заменён скрытием CSS-классом.
- **FIXED** `e28a516` — unhandled rejection инициализации agent-control:
  ошибка помечается обработанной и отдаётся первому запросу как HTTP 500.
- **CONFIRMED (open, смягчено)** — ~112 селекторов завязаны на вёрстку upstream;
  теперь они собраны в отдельных src-фрагментах (проще ревизовать), но реестра
  селекторов с комментариями пока нет.

### Desktop и security-патч

- **FIXED** `e41b2cc` — симлинк-матрица: 11 кейсов (symlink наружу
  файл/каталог/вложенный, traversal, абсолютный путь, коллизия префиксов, лимит,
  каталог, легальный симлинк внутрь) + TOCTOU сокращён fd-чтением
  (open по каноническому пути с `O_NOFOLLOW` → fstat → чтение из handle);
  остаточное окно промежуточного каталога честно задокументировано в коде.
- **FIXED** `c44e2b1` — личный путь `~/Documents/Vibe` удалён из desktop-оболочки.
- **CONFIRMED (open)** — нет таймаута запуска в macOS-приложении
  (`HarnessService.swift`, состояние `.starting` вечно).

---

## 4. Производительность — статусы

- **FIXED** `32aac10`+`0e0d61b` — петля рендера (см. C3).
- **FIXED** `aee1d23` — 500-мс интервал (12 полных translate-проходов/сек)
  удалён: он полностью дублировал observer-конвейер (те же функции в
  OVERLAY_FEATURES). Основной канал — observer с наблюдением переводимых
  атрибутов; страховочный проход — раз в 30 с, в idle не пишет в DOM.
- **FIXED** `aee1d23` — SSH-backoff (см. выше).
- **CONFIRMED (open)** — TreeWalker-проходы по всему body на каждый проход
  конвейера (bounded: только по фактическим мутациям, но на больших DOM дорого;
  следующий шаг — скоупинг переводов на mutation-roots).
- **CONFIRMED (open)** — `configure-profile` всегда «полный» (manifestSha256
  пишется, но не используется для short-circuit); `downloads/` не чистится
  (60 МБ); N+1 к GitHub API в skill-installer; `$ProgressPreference` в PS 5.1.

---

## 5. AI-пригодность — статусы

Закрыто до этой серии (26.08, коммиты `f6e57e6`, `383ba00`): **OBSOLETE** —
«нет CLAUDE.md/AGENTS.md» — оба существуют: AGENTS.md (правила + индекс из 11
скиллов + инварианты), CLAUDE.md (импорт @AGENTS.md), 5 проектных + 6 вендорных
скиллов.

Закрыто этой серией:

- **FIXED** `ad7f6bb` — корневой package.json: `npm test`/`verify`/`test:unit`/
  `test:dom`/`lint`/`format:check`; ESLint (correctness-only, репозиторий чистый),
  prettier; lock закоммичен. Найден и удалён мёртвый импорт.
- **FIXED** `27f7b3e` — lint-джоба CI: eslint + prettier + DOM-тесты +
  shellcheck (errors) + PSScriptAnalyzer (errors).
- **PARTIALLY FIXED** `91ed6f3` — монолит client.js: теперь generated-артефакт из
  20 фрагментов `src/client/*` с zero-dep детерминированной сборкой
  (`scripts/build-ui-client.mjs`, `--check` в verify.sh, sha256 сверен);
  дальнейшая модуляризация — итеративно.
- **PARTIALLY FIXED** `f7a7174`/`0e0d61b` — регекс-тесты: поведенческие DOM-тесты
  добавлены; регекс-инварианты оставлены как осознанные растяжки.
- **FIXED** `c44e2b1` — гигиена: скриншоты/отчёты из корня → artifacts/,
  `script/` влит в `scripts/`, мёртвый runtime/python удалён, личные SSH-алиасы
  убраны из публичных доков.
- **CONFIRMED (open)** — дублирование констант (порт 3080 ×9, 11434 ×6, путь
  bin.js ×8, версии node/pnpm в workflow); README «Полный состав» без машинной
  сверки; захардкоженные версии-растяжки в kit-config.test.mjs (задокументированы
  в AGENTS.md).

---

## 6. Тесты и CI — статусы

Было: 6 сьютов, 0% на рискованных путях. Стало:

- **FIXED** — `applyUpdate`: 9 сценариев (успех/SHA/asset/распаковка/остановка/
  установщик/перезапуск/не-требуется/параллельный лок) с инвариантами сохранности
  user home и прежней установки (`f6f7861`).
- **FIXED** — лок: контенция/stale/orphan/чужой (`e9f9cea`); PS-безопасный слой:
  argv/temp/exit-коды/guards (`7c1c515`).
- **FIXED** — симлинк-матрица патча (`e41b2cc`).
- **FIXED** — поведенческие DOM-тесты (`0e0d61b`), детерминированные (15/15).
- **FIXED** — CI: Windows-джоба гоняет 6 node-сьютов + failure-path smoke
  настоящим powershell.exe 5.1 (`efa1d9b`); Linux-джоба исполняет установщик
  end-to-end: fresh+idempotent+preservation+dump-config+failure paths
  (`af6f542`); lint-джоба (`27f7b3e`).
- **CONFIRMED (open)** — без тестов: `configure-profile.mjs` (только CI-smoke),
  `update-profile-lock.mjs`, `check-upstream-dsh.mjs`, fleet-sync при
  недоступном сервере, негативные ветки `validateManifest`.

---

## 7. Безопасность — статусы

- **FIXED** `e41b2cc` — TOCTOU патча (fd-чтение) + полная симлинк-матрица.
- **FIXED** `c853195` — skill-installer фиксирует commit SHA вместо ветки
  (requestedRef сохраняется для читаемости); покрыто тестами.
- **FIXED** `4db6afd` — README больше не завышает («вычисляет и показывает»
  SHA-256; SHA-сверка только Node/Ollama); guard verify.sh запрещает любые
  не-SHA ref у actions; модель доверия — таблицей в SECURITY.md.
- **CONFIRMED (open)** — scanSkillRisk обходим (rm -fr, base64, node -e) — это
  заявленная «базовая проверка», но зелёная строка в диалоге создаёт ложную
  уверенность; WebView пускает чужие хосты внутрь окна; ProcessTree без killpg;
  Ollama-модель по mutable-тегу; транзитивы LSP без lock.

---

## 8. Средние находки

Статусы изменившихся: guard корня с хвостовым слэшем — **FIXED** `6bd0542`
(+CI-тест); затирание success-статуса ошибкой перезапуска — **FIXED** `cbfb6e9`;
value контролируемых инпутов — **PARTIALLY FIXED** `32aac10` (равенство
проверяется); Linux CI — **FIXED** `af6f542`. Остальные медиумы из перечня
26.08 (таймауты сети updater, откат configure-profile, неатомарная пара
check-upstream, copyLocalPlugins, ConnectTimeout fleet, systemd-кавычки, linger,
Info.plist-версии в репо, dual-цепочка npx, CHANGELOG-разрыв и пр.) —
**CONFIRMED (open)**, приоритезированы в «Осталось» ниже.

---

## 9. Осталось (приоритезировано)

**P0 remaining:** нет.

**P1 remaining:**
1. Квотирование `run()` с `shell: true` (пробел в Windows-пути профиля).
2. Нотарификация релизного .app либо принудительно-локальная сборка.
3. Таймаут запуска в macOS-оболочке.
4. Тесты `configure-profile.mjs` / fleet-sync failure paths + `ConnectTimeout`.
5. Guard verify.sh на standalone-инвариант bin-копий (только `node:`-импорты).

**P2:** скоупинг переводов на mutation-roots; short-circuit configure-profile по
manifestSha256; очистка `downloads/`; killpg в ProcessTree; дайджест
Ollama-модели; lock для LSP; генерация README «Полный состав» из kit.json;
sysmon/dialog строковые хаки vs ru-локаль; CHANGELOG-дисциплина.

**Needs real Windows verification:** установка (Invoke-Checked), самообновление
(-File путь, лок, остановка/перезапуск), `.cmd`-обёртки — CI-smoke покрывает
установку и failure path, но полный цикл обновления на живой Windows не
прогонялся.

**Needs real macOS verification:** живой цикл обновления поверх работающего
приложения (строгий stop + pgrep-guard); UI-оверлей в реальном Harness после
идемпотентного рендера (десктоп-смоук: бейдж, переключатель сред, переводы).

**Needs real Linux verification:** установка на реальном сервере с
Ollama/systemd (CI использует SKIP_OLLAMA); fleet-sync на настроенные серверы.

---

## 9а. Что вскрыл сам обновлённый CI (пост-серия)

Первые же честные прогоны Windows-джобы нашли три латентных
кросс-платформенных дефекта — прямое подтверждение ценности исправленных гейтов:

1. **FIXED** `072f241` — `"$Description:"` в новом Invoke-Checked парсился как
   scoped-переменная `$scope:name` (вскрыто починенным аккумулирующим
   парс-шагом; раньше ошибка была бы замаскирована багом `[ref]$errors`).
2. **FIXED** `72220cc` — CRLF-checkout Git for Windows ломал проверку
   lock-покрытия; добавлен `.gitattributes` (LF-нативный репозиторий, CRLF
   только для `.cmd`) + `\r`-толерантный регекс.
3. **FIXED** `c0571e6` — POSIX-проверка execute-битов в тесте
   `repairNodePtySpawnHelpers` не применима к NTFS — гвардирована по платформе.

Итог: run `33020486464` — **все четыре джобы зелёные**, включая Windows-шаг
«Installer failure path must not leave a "healthy" install» на настоящем
`powershell.exe` 5.1 (симулированный сбой → установка падает, маркер не
появляется, битый stage не становится source, unsafe-root отклонён) и
Linux-джобу с полной установкой end-to-end.

## 10. Методика перепроверки

Каждый критический/высокий пункт перепроверен по текущему коду до правок
(grep/чтение, для C1/C2/C3 — построчно; для happy-dom и guard'ов — изолированные
эксперименты). Исправления вносились маленькими коммитами с прогоном
релевантных тестов и максимально доступной части `./scripts/verify.sh` после
каждого. Windows-семантика проверена кодом + CI-smoke на windows-2025
(powershell.exe 5.1); живой Windows-цикл обновления не запускался — см.
«Needs real Windows verification».
