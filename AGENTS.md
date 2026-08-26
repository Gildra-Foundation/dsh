# Gildra DSH — правила для ИИ-агентов

Этот файл — общая инструкция для любого кодового агента (Codex, Claude Code,
Cursor и др.), работающего в репозитории. Claude Code дополнительно
подхватывает скиллы из `.claude/skills/` автоматически; агенты без нативной
поддержки скиллов обязаны читать нужный `SKILL.md` по индексу ниже.

## Что это за проект

Gildra DSH — воспроизводимая сборка DeepSeek Harness (среда ИИ-разработки) для
macOS, Windows и Linux-сервера. Три слоя с жёсткими границами
(`docs/architecture.md`): **Kit Manifest** (`config/kit.json` — единственный
источник версий и состава) → **Desktop Host** (`desktop/macos`, нативная
оболочка) → **Harness Overlay** (`plugins/gildra-dsh-ui-compact`, UI поверх
DOM Harness).

## Проверка изменений

Перед завершением любой правки запускай из корня:

```bash
./scripts/verify.sh
```

Точечные тесты: `node scripts/kit-config.test.mjs`,
`node plugins/gildra-dsh-ui-compact/test.mjs` и другие `*.test.mjs` рядом с
кодом. Linux-установщик и Windows-скрипты в CI не исполняются — для них
обязательна ручная проверка логики.

## Принципы поведения

Полная версия — `.claude/skills/karpathy-guidelines/SKILL.md`. Кратко:

1. **Думай до кода** — проговаривай допущения, при неоднозначности спрашивай.
2. **Простота прежде всего** — не превращай 50 строк в 500.
3. **Хирургические правки** — не трогай код вне задачи; в этом репо есть
   намеренные «растяжки» в тестах и намеренные дубли (см. инварианты).
4. **Проверяемый результат** — критерий успеха + доказательство (тест, запуск).

## Индекс скиллов: прочитай перед задачей

| Если задача касается… | Сначала прочитай |
| --- | --- |
| Версий/состава плагинов, `config/kit.json`, lock-файла | `.claude/skills/bump-plugin/SKILL.md` |
| Выпуска, бампа версии дистрибутива, тега | `.claude/skills/release/SKILL.md` |
| Любых `.ps1`/`.cmd`, Windows-веток в `scripts/*.mjs` | `.claude/skills/powershell-51/SKILL.md` |
| Файлов в `install/`, корневых лаунчеров | `.claude/skills/installer-parity/SKILL.md` |
| `plugins/gildra-dsh-ui-compact` (client.js / index.js) | `.claude/skills/client-feature/SKILL.md` |
| `plugins/gildra-dsh-runtime` (sessions/workspaces/leases) | `docs/architecture.md` §2а + тесты плагина как спецификация |
| Реализации фичи или багфикса (до написания кода) | `.claude/skills/test-driven-development/SKILL.md` |
| Любого бага, падающего теста, странного поведения | `.claude/skills/systematic-debugging/SKILL.md` |
| Плана крупной задачи | `.claude/skills/writing-plans/SKILL.md` |
| Подготовки изменения к ревью | `.claude/skills/requesting-code-review/SKILL.md` |
| Заявления «готово» / завершения задачи | `.claude/skills/verification-before-completion/SKILL.md` |

Происхождение вендорных скиллов и их пины — `.claude/skills/UPSTREAM.md`.

## Инварианты репозитория (нарушение = сломанная поставка)

- **Версии и спеки плагинов живут только в `config/kit.json`.** В установщиках
  их быть не должно — `verify.sh` это грепает и падает.
- **`scripts/gildra-update.mjs` и `scripts/sync-server-fleet.mjs` —
  standalone-файлы**: копируются в `~/.gildra-dsh/bin` и могут использовать
  только встроенные `node:`-модули. Не выноси из них «дубли» в общие модули.
- **Хардкод-версии в `scripts/kit-config.test.mjs` — намеренные растяжки**
  (версия дистрибутива, Ollama, `dsh-doublecheck@…`): при бампе обновляй
  значение, не удаляй и не ослабляй ассерты.
- **Три установщика (zsh/bash/PowerShell) правятся синхронно**; три разных
  `parseArgs`/`run()` в скриптах — осознанная цена standalone-контракта, не
  «унифицируй» их.
- **Порт 3080, порт Ollama 11434 и путь `source/apps/cli/lib/bin.js`
  продублированы по многим файлам** — меняешь значение, грепни репозиторий.
- В `plugins/gildra-dsh-ui-compact/test.mjs` ассерты привязаны к тексту
  `client.js` — рефакторинг клиента требует синхронного обновления ассертов.
- **Gildra Runtime (`plugins/gildra-dsh-runtime`)** использует только
  `node:`-модули (как все локальные плагины); orchestration-логика сессий/
  worktree/lease/merge живёт ТОЛЬКО там — не переноси её в DOM-оверлей и не
  выполняй управляемые git-операции (checkout/switch/reset --hard/clean -f/
  worktree remove) внутри `<installRoot>/workspaces/**` — это ломает изоляцию
  сессий, и tools-guard такие команды блокирует.
- **`plugins/gildra-dsh-ui-compact/lib/client.js` — generated-артефакт**:
  правь фрагменты в `plugins/gildra-dsh-ui-compact/src/client/*`, затем
  пересобери `node scripts/build-ui-client.mjs`; verify.sh гоняет `--check`
  и упадёт при рассинхроне. Руками lib/client.js не редактируется.

## Чего не делать

- Не коммитить credentials, `.dsh` пользователя, сессии, SSH-ключи, приватные
  проекты; не добавлять секреты в установщики и workflow.
- Не создавать release-теги и не публиковать релизы без явной просьбы —
  выпуск делает maintainer (`CONTRIBUTING.md`).
- Не править `config/profile/pnpm-lock.yaml` и `desktop/macos/Info.plist`
  руками — они генерируются (`scripts/update-profile-lock.mjs`, `build.sh`).
- Не смешивать функциональные изменения с несвязанным рефакторингом.
